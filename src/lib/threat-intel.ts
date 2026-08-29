import type { Address } from "viem";

export interface ThreatSourceResult {
  status: "clean" | "warning" | "danger" | "unavailable";
  dangerHits: string[];
  warnHits: string[];
  dataSource?: string;
  detail: string;
}

export interface UnifiedThreatReport {
  overallStatus: "pass" | "warning" | "danger" | "unavailable";
  dangerFlags: string[];
  cautionFlags: string[];
  goplusBase: ThreatSourceResult;
  goplusEth: ThreatSourceResult;
  scamsniffer: "listed" | "not-listed" | "unavailable";
  sourcesChecked: number;
}

// 10-minute in-memory cache for ScamSniffer raw GitHub array
let scamSnifferCache: { list: Set<string>; cachedAt: number } | null = null;
const SCAMSNIFFER_CACHE_TTL_MS = 10 * 60 * 1000;

const DANGER_KEYS = [
  "phishing_activities",
  "blacklist_doubt",
  "stealing_attack",
  "honeypot_related_address",
  "fake_kyc",
  "cybercrime",
];

const WARN_KEYS = [
  "money_laundering",
  "darkweb_transactions",
  "sanctioned",
  "mixer",
  "malicious_mining_activities",
  "gas_abuse",
  "financial_crime",
  "blackmail_activities",
  "fake_token",
  "number_of_malicious_contracts_created",
];

async function fetchGoPlus(address: string, chainId: string): Promise<ThreatSourceResult> {
  try {
    const url = `https://api.gopluslabs.io/api/v1/address_security/${address}?chain_id=${chainId}`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Shield-Agent/1.0" },
    });

    if (!res.ok) {
      return {
        status: "unavailable",
        dangerHits: [],
        warnHits: [],
        detail: `HTTP ${res.status}`,
      };
    }

    // Safely handle non-JSON (e.g. Cloudflare HTML) – do not let SyntaxError crash the scan
    let data: any = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      return {
        status: "unavailable",
        dangerHits: [],
        warnHits: [],
        detail: "Non-JSON response from GoPlus",
      };
    }
    if (data?.code === 1 && data?.result) {
      const r = data.result as Record<string, string>;
      const dangerHits = DANGER_KEYS.filter((k) => r[k] === "1");
      const warnHits = WARN_KEYS.filter((k) => r[k] === "1");

      if (dangerHits.length > 0) {
        return {
          status: "danger",
          dangerHits,
          warnHits,
          dataSource: r.data_source || "GoPlus",
          detail: `Listed for: ${dangerHits.join(", ")}`,
        };
      }

      if (warnHits.length > 0) {
        return {
          status: "warning",
          dangerHits: [],
          warnHits,
          dataSource: r.data_source || "GoPlus",
          detail: `Caution flags: ${warnHits.join(", ")}`,
        };
      }

      return {
        status: "clean",
        dangerHits: [],
        warnHits: [],
        dataSource: r.data_source || "GoPlus",
        detail: "No malicious flags",
      };
    }

    return {
      status: "unavailable",
      dangerHits: [],
      warnHits: [],
      detail: "Unexpected response shape",
    };
  } catch (error) {
    return {
      status: "unavailable",
      dangerHits: [],
      warnHits: [],
      detail: error instanceof Error ? error.message : "Request failed",
    };
  }
}

async function fetchScamSnifferList(): Promise<Set<string> | null> {
  const now = Date.now();
  if (scamSnifferCache && now - scamSnifferCache.cachedAt < SCAMSNIFFER_CACHE_TTL_MS) {
    return scamSnifferCache.list;
  }

  try {
    const url = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json";
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Shield-Agent/1.0" },
    });

    if (res.ok) {
      let rawList: any = null;
      try {
        const text = await res.text();
        rawList = text ? JSON.parse(text) : null;
      } catch {
        // Non-JSON from GitHub (rate limit HTML) – treat as unavailable, use cache if present
        return scamSnifferCache ? scamSnifferCache.list : null;
      }
      if (Array.isArray(rawList)) {
        const addressSet = new Set(rawList.map((a: string) => String(a).toLowerCase()));
        scamSnifferCache = { list: addressSet, cachedAt: now };
        return addressSet;
      }
    }
  } catch (error) {
    console.warn("ScamSniffer DB fetch failed:", error);
  }

  return scamSnifferCache ? scamSnifferCache.list : null;
}

export function resetScamSnifferCacheForTesting(): void {
  scamSnifferCache = null;
}

export async function getThreatReport(address: Address): Promise<UnifiedThreatReport> {
  const normalized = address.toLowerCase();

  const [gpBaseRes, gpEthRes, snifferList] = await Promise.all([
    fetchGoPlus(normalized, "8453"), // Base Mainnet
    fetchGoPlus(normalized, "1"),    // Ethereum Mainnet
    fetchScamSnifferList(),
  ]);

  let scamsnifferStatus: "listed" | "not-listed" | "unavailable" = "unavailable";
  if (snifferList) {
    scamsnifferStatus = snifferList.has(normalized) ? "listed" : "not-listed";
  }

  const dangerFlags = new Set<string>();
  const cautionFlags = new Set<string>();

  gpBaseRes.dangerHits.forEach((h) => dangerFlags.add(`Base: ${h}`));
  gpBaseRes.warnHits.forEach((h) => cautionFlags.add(`Base: ${h}`));

  gpEthRes.dangerHits.forEach((h) => dangerFlags.add(`Ethereum: ${h}`));
  gpEthRes.warnHits.forEach((h) => cautionFlags.add(`Ethereum: ${h}`));

  if (scamsnifferStatus === "listed") {
    dangerFlags.add("ScamSniffer Blacklist: Verified Phishing/Drainer Address");
  }

  let sourcesChecked = 0;
  if (gpBaseRes.status !== "unavailable") sourcesChecked++;
  if (gpEthRes.status !== "unavailable") sourcesChecked++;
  if (scamsnifferStatus !== "unavailable") sourcesChecked++;

  let overallStatus: UnifiedThreatReport["overallStatus"] = "pass";
  if (dangerFlags.size > 0) {
    overallStatus = "danger";
  } else if (cautionFlags.size > 0) {
    overallStatus = "warning";
  } else if (sourcesChecked === 0) {
    overallStatus = "unavailable";
  }

  return {
    overallStatus,
    dangerFlags: Array.from(dangerFlags),
    cautionFlags: Array.from(cautionFlags),
    goplusBase: gpBaseRes,
    goplusEth: gpEthRes,
    scamsniffer: scamsnifferStatus,
    sourcesChecked,
  };
}
