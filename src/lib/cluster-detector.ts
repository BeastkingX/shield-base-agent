import type { Address } from "viem";
import { fetchWithRetry, RETRY_ATTEMPTS } from "./retry";

/**
 * Shield Cluster Detector v2, High-Performance Real Measurement Engine.
 * Optimizations: Parallel 2-hop traversal, fast timeouts (<4s), zero sequential sleep bottlenecks.
 */

export interface MoneyTrailGraph {
  upstreamFunder: string;
  funderType: string;
  target: string;
  downstreamHub: string;
  hubType: string;
}

export interface ClusterAnalysis {
  targetAddress: Address;
  hasTaint: boolean;
  taintSeverity: "none" | "warning" | "critical";
  clusterTaintName: string | null;
  seedFunder: string;
  sweepDestination: string;
  isSweeperActive: boolean;
  sweepVelocitySeconds: number | null;
  forensicTraceNotes: string[];
  moneyTrailGraph: MoneyTrailGraph;
  analysisStatus: "completed" | "partial" | "unavailable";
  velocitySamples: number;
  retainedRatio: number | null;
  funderProfile: string;
  hubProfile: string;
  hop2Funder: string | null;
  sampledTransactions: number;
  recentRapidForwarding: boolean;
  recentDeltas: number[];
}

const PRO_COMPAT_URL = "https://api.blockscout.com/v2/api";
const PUBLIC_COMPAT_URL = "https://base.blockscout.com/api";
const BASE_CHAIN_ID = "8453";

const GAS_HINT_WEI = BigInt("500000000000000"); // 0.0005 ETH
const SWEEP_THRESHOLD_SECONDS = 30;
const RAPID_FORWARD_SECONDS = 120;
const MIN_VELOCITY_SAMPLES = 2;
const TARGET_WINDOW = 30;
const HOP_WINDOW = 10;
/**
 * Shared retry budget for one history window. analyzeClusterTaint reads up to
 * four windows (earliest+recent parallel, funder+hub parallel), so total worst
 * is 2*budget. Reduced from 6s to 4s to stay inside Vercel's 26s hard budget
 * when wallet path also runs history+approvals+threat in parallel.
 * Honest partial-mode: if earliest window times out, recent window still counts.
 */
const HISTORY_BUDGET_MS = 4_000;

interface IndexedTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
  txreceipt_status: string;
  methodId: string;
  functionName: string;
}

/** Performs one compatibility-API txlist request against `baseUrl`. */
async function requestCompatTxList(
  baseUrl: string,
  address: string,
  sort: "asc" | "desc",
  offset: number,
  options: { withKey: boolean; attempts: number; deadlineAt: number },
): Promise<IndexedTx[]> {
  const url = new URL(baseUrl);
  if (options.withKey) {
    url.searchParams.set("chain_id", BASE_CHAIN_ID);
    url.searchParams.set("apikey", process.env.BLOCKSCOUT_API_KEY?.trim() ?? "");
  }
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "9999999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", sort);

  const response = await fetchWithRetry(
    url,
    { cache: "no-store" },
    {
      timeoutMs: 2500,
      attempts: options.attempts,
      deadlineAt: options.deadlineAt,
      label: `Blockscout txlist (${options.withKey ? "keyed" : "keyless"})`,
    },
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let body: { status?: string; message?: string; result?: unknown };
  try {
    const text = await response.text();
    body = (text ? JSON.parse(text) : {}) as {
      status?: string;
      message?: string;
      result?: unknown;
    };
  } catch {
    throw new Error(`compatibility route returned non-JSON`);
  }

  if (body.status === "1" && Array.isArray(body.result)) {
    return body.result as IndexedTx[];
  }
  if (/no transactions found/i.test(body.message ?? "")) return [];
  if (typeof body.result === "string" && /too many requests/i.test(body.result)) {
    throw new Error("rate limited by compatibility route");
  }
  throw new Error(`compatibility route rejected the request (${body.message ?? "unknown"})`);
}

async function fetchTxList(
  address: string,
  options: { sort?: "asc" | "desc"; offset?: number } = {},
): Promise<IndexedTx[]> {
  const { sort = "asc", offset = TARGET_WINDOW } = options;
  const apiKey = process.env.BLOCKSCOUT_API_KEY?.trim();
  // One shared budget so retries cannot outlast the calling API route.
  const deadlineAt = Date.now() + HISTORY_BUDGET_MS;
  const errors: string[] = [];

  // 1. Keyed compatibility API (full retry policy), or the public one when no
  //    server key is configured.
  try {
    return await requestCompatTxList(
      apiKey ? PRO_COMPAT_URL : PUBLIC_COMPAT_URL,
      address,
      sort,
      offset,
      { withKey: Boolean(apiKey), attempts: RETRY_ATTEMPTS, deadlineAt },
    );
  } catch (err: unknown) {
    errors.push(err instanceof Error ? err.message : "keyed txlist failed");
  }

  // 2. Keyless compatibility endpoint, tried exactly once, only when a key was
  //    in play. A rate-limited paid key must not cost the scan its history.
  if (apiKey) {
    try {
      return await requestCompatTxList(PUBLIC_COMPAT_URL, address, sort, offset, {
        withKey: false,
        attempts: 1,
        deadlineAt,
      });
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : "keyless txlist failed");
    }
  }

  // 3. Open Blockscout REST API v2.
  try {
    const restUrl = `https://base.blockscout.com/api/v2/addresses/${address}/transactions`;
    const response = await fetchWithRetry(
      restUrl,
      { cache: "no-store" },
      {
        timeoutMs: 2500,
        attempts: RETRY_ATTEMPTS,
        deadlineAt,
        label: "Blockscout REST v2",
      },
    );
    if (!response.ok) throw new Error(`REST API HTTP ${response.status}`);

    let body: any = null;
    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("REST API returned non-JSON");
    }
    if (Array.isArray(body.items)) {
      const mapped: IndexedTx[] = body.items.map((it: any) => ({
        hash: it.hash || "",
        from: it.from?.hash || "",
        to: it.to?.hash || "",
        value: it.value || "0",
        timeStamp: it.timestamp ? String(Math.floor(Date.parse(it.timestamp) / 1000)) : "",
        isError: it.status === "error" ? "1" : "0",
        txreceipt_status: it.status === "ok" || it.status === "success" ? "1" : "0",
        methodId: it.method?.startsWith("0x") ? it.method : "",
        functionName: it.method || "",
      }));
      if (sort === "asc") {
        mapped.sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
      } else {
        mapped.sort((a, b) => Number(b.timeStamp) - Number(a.timeStamp));
      }
      return mapped.slice(0, offset);
    }
    errors.push("REST API returned an unexpected shape");
  } catch (err: unknown) {
    errors.push(err instanceof Error ? err.message : "REST API failed");
  }

  throw new Error(`indexed history unavailable (${errors.join(" | ")})`);
}

const isSuccessful = (tx: IndexedTx): boolean =>
  tx.isError === "0" && tx.txreceipt_status !== "0";

const txValue = (tx: IndexedTx): bigint => {
  try {
    return BigInt(tx.value || "0");
  } catch {
    return BigInt(0);
  }
};

const sameAddress = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

const isTokenTransferCall = (tx: IndexedTx): boolean =>
  (tx.functionName ?? "").toLowerCase().startsWith("transfer") ||
  (tx.methodId ?? "").toLowerCase() === "0xa9059cbb";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function unavailableResult(target: Address, note: string): ClusterAnalysis {
  return {
    targetAddress: target,
    hasTaint: false,
    taintSeverity: "none",
    clusterTaintName: null,
    seedFunder: "Unknown (history unavailable)",
    sweepDestination: "Unknown (history unavailable)",
    isSweeperActive: false,
    sweepVelocitySeconds: null,
    forensicTraceNotes: [note],
    moneyTrailGraph: {
      upstreamFunder: "Unknown (history unavailable)",
      funderType: "Unread",
      target,
      downstreamHub: "Unknown (history unavailable)",
      hubType: "Unread",
    },
    analysisStatus: "unavailable",
    velocitySamples: 0,
    retainedRatio: null,
    funderProfile: "Unread",
    hubProfile: "Unread",
    hop2Funder: null,
    sampledTransactions: 0,
    recentRapidForwarding: false,
    recentDeltas: [],
  };
}

export async function analyzeClusterTaint(
  targetAddress: Address,
): Promise<ClusterAnalysis> {
  const target = targetAddress.toLowerCase() as Address;
  const notes: string[] = [];
  const gaps: string[] = [];

  // Parallel fetch: earliest (genesis) + recent (active) windows
  const [earliestRes, recentRes] = await Promise.allSettled([
    fetchTxList(target, { sort: "asc", offset: TARGET_WINDOW }),
    fetchTxList(target, { sort: "desc", offset: TARGET_WINDOW }),
  ]);

  const earliest = earliestRes.status === "fulfilled" ? earliestRes.value : [];
  const recent = recentRes.status === "fulfilled" ? recentRes.value : [];

  if (earliestRes.status === "rejected") gaps.push(`earliest unread (${earliestRes.reason?.message})`);
  if (recentRes.status === "rejected") gaps.push(`recent unread (${recentRes.reason?.message})`);

  if (earliest.length === 0 && recent.length === 0 && gaps.length > 0) {
    return unavailableResult(
      targetAddress,
      "Indexed history was unavailable at scan time; money-trail checks did not run.",
    );
  }

  const seen = new Set<string>();
  const allTx = [...earliest, ...recent].filter((tx) => {
    if (!tx.hash || seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });
  const fullHistory = earliest.length < TARGET_WINDOW && gaps.length === 0;
  notes.push(
    `Sampled ${allTx.length} transaction(s), ${
      fullHistory ? "covers full indexed history" : "windowed sample view"
    }.`,
  );

  const inboundNative = allTx
    .filter((tx) => isSuccessful(tx) && sameAddress(tx.to, target) && txValue(tx) > BigInt(0))
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
  const outbound = allTx.filter(
    (tx) =>
      isSuccessful(tx) &&
      sameAddress(tx.from, target) &&
      (txValue(tx) > BigInt(0) || isTokenTransferCall(tx)),
  );

  // 1-hop upstream
  const seedTx = inboundNative[0];
  const seedFunder: string | null = seedTx ? seedTx.from : null;
  notes.push(
    seedTx
      ? `Earliest sampled inbound native funding: ${(Number(txValue(seedTx)) / 1e18).toFixed(6)} ETH from ${seedFunder}.`
      : "No inbound native funding observed in sampled history.",
  );

  // Identify dominant hub destination
  const byDestination = new Map<string, { count: number; value: bigint }>();
  for (const tx of outbound) {
    const dest = (tx.to ?? "").toLowerCase();
    if (!dest) continue;
    const current = byDestination.get(dest) ?? { count: 0, value: BigInt(0) };
    current.count += 1;
    current.value = current.value + txValue(tx);
    byDestination.set(dest, current);
  }
  const rankedDestinations = [...byDestination.entries()].sort(
    (a, b) => b[1].count - a[1].count || (a[1].value > b[1].value ? -1 : 1),
  );
  const hub = rankedDestinations[0]?.[0] ?? null;

  // Parallel Hop 2: profile funder and hub concurrently
  let funderType = seedFunder ? "Analyzing funder..." : "Unknown (no inbound funder)";
  let hop2Funder: string | null = null;
  let hubType = hub && outbound.length >= 3 ? "Analyzing hub..." : "No outbound forwarding observed";

  const [funderHopRes, hubHopRes] = await Promise.allSettled([
    seedFunder ? fetchTxList(seedFunder, { sort: "asc", offset: HOP_WINDOW }) : Promise.resolve([]),
    hub && outbound.length >= 3 ? fetchTxList(hub, { sort: "desc", offset: HOP_WINDOW }) : Promise.resolve([]),
  ]);

  // Process funder hop
  if (seedFunder) {
    if (funderHopRes.status === "fulfilled" && Array.isArray(funderHopRes.value) && funderHopRes.value.length > 0) {
      const funderTxs = funderHopRes.value;
      const funderOutbound = funderTxs.filter(
        (tx) => isSuccessful(tx) && sameAddress(tx.from, seedFunder) && txValue(tx) > BigInt(0),
      );
      const tinyOutbound = funderOutbound.filter((tx) => txValue(tx) <= GAS_HINT_WEI);
      const distinctRecipients = new Set(tinyOutbound.map((tx) => (tx.to ?? "").toLowerCase()));
      hop2Funder =
        funderTxs.find(
          (tx) => isSuccessful(tx) && sameAddress(tx.to, seedFunder) && txValue(tx) > BigInt(0),
        )?.from ?? null;
      notes.push(`Hop-2: seed funder was itself first funded by ${hop2Funder ?? "not observed in window"}.`);
      funderType =
        distinctRecipients.size >= 8 && tinyOutbound.length / Math.max(funderOutbound.length, 1) >= 0.7
          ? `Gas-dispenser pattern (measured): ${distinctRecipients.size} distinct addresses funded with <=0.0005 ETH each.`
          : `No dispenser pattern measured (${funderOutbound.length} outbound, ${distinctRecipients.size} small-value recipients).`;
    } else {
      funderType = "Unread (funder history unavailable)";
      gaps.push("funder hop unread");
    }
  }

  // Process hub hop
  if (hub && outbound.length >= 3) {
    if (hubHopRes.status === "fulfilled" && Array.isArray(hubHopRes.value) && hubHopRes.value.length > 0) {
      const hubTxs = hubHopRes.value;
      const distinctSources = new Set(
        hubTxs
          .filter((tx) => isSuccessful(tx) && sameAddress(tx.to, hub))
          .map((tx) => (tx.from ?? "").toLowerCase()),
      );
      hubType =
        distinctSources.size >= 8
          ? `Consolidation-hub pattern (measured): inbound from ${distinctSources.size} distinct sources.`
          : `Top outflow destination (${rankedDestinations[0][1].count}/${outbound.length} sampled outbound); no aggregator pattern.`;
      notes.push(`Dominant outflow hub: ${hub} (${rankedDestinations[0][1].count} of ${outbound.length} outbound transfers).`);
    } else {
      hubType = "Unread (hub history unavailable)";
      gaps.push("hub hop unread");
    }
  }

  // Sweep velocity
  const outboundTimes = outbound
    .map((tx) => Number(tx.timeStamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const deltas: number[] = [];
  for (const deposit of inboundNative) {
    const tIn = Number(deposit.timeStamp);
    if (!Number.isFinite(tIn)) continue;
    const tOut = outboundTimes.find((t) => t >= tIn);
    if (tOut !== undefined) deltas.push(tOut - tIn);
  }
  const velocityMedian = median(deltas);
  const velocitySamples = deltas.length;
  const isSweeperActive =
    velocitySamples >= MIN_VELOCITY_SAMPLES &&
    velocityMedian !== null &&
    velocityMedian <= SWEEP_THRESHOLD_SECONDS;
  notes.push(
    velocitySamples >= MIN_VELOCITY_SAMPLES
      ? `Measured deposit-to-forward deltas (s): [${deltas.join(", ")}], median ${velocityMedian}s over ${velocitySamples} sample(s).`
      : `Too few deposit/forward pairs to measure sweep velocity (${velocitySamples} sample(s)).`,
  );

  // Retained value
  const sumIn = inboundNative.reduce((acc, tx) => acc + txValue(tx), BigInt(0));
  const sumOut = outbound.reduce((acc, tx) => acc + txValue(tx), BigInt(0));
  const retainedRatio = sumIn > BigInt(0) ? Math.max(1 - Number(sumOut) / Number(sumIn), 0) : null;

  // Recency-aware velocity
  // Threshold rule: deltas.at(-1) <= 60 || (deltas.slice(-2).length === 2 && deltas.slice(-2).every(d => d <= 120))
  const recentWindow = deltas.slice(-2);
  const lastDelta = deltas.length > 0 ? deltas[deltas.length - 1] : undefined;
  const recentRapidForwarding =
    (lastDelta !== undefined && lastDelta <= 60) ||
    (recentWindow.length === 2 && recentWindow.every((d) => d <= 120));

  // Severity
  const dispenser = funderType.startsWith("Gas-dispenser pattern");
  const aggregator = hubType.startsWith("Consolidation-hub pattern");
  let severity: ClusterAnalysis["taintSeverity"] = "none";
  let name: string | null = null;

  if (isSweeperActive && (retainedRatio === null || retainedRatio < 0.2) && (dispenser || aggregator)) {
    severity = "critical";
    name = "Measured rapid-sweep compromise pattern";
  } else if (
    isSweeperActive ||
    (velocitySamples >= MIN_VELOCITY_SAMPLES && velocityMedian !== null && velocityMedian <= RAPID_FORWARD_SECONDS)
  ) {
    severity = "warning";
    name = "Automated forwarding pattern (measured, unattributed)";
  } else if (recentRapidForwarding && severity === "none") {
    severity = "warning";
    name = "Recent rapid-forwarding state change";
    notes.push(
      `Most recent deposits forwarded in ${recentWindow.join("s / ")}s (behavioral state change vs lifetime median of ${velocityMedian ?? "N/A"}s).`,
    );
  }

  if (severity === "none") {
    notes.push("No rapid-forwarding or cluster pattern measured in the sampled history.");
  }

  // A "partial" status is only honest if the receipt says what is missing.
  if (gaps.length > 0) {
    notes.push(
      `Incomplete history: ${gaps.join("; ")}. Conclusions below rest only on the windows Shield could read.`,
    );
  }

  return {
    targetAddress,
    hasTaint: severity !== "none",
    taintSeverity: severity,
    clusterTaintName: name,
    seedFunder: seedFunder ?? "None observed",
    sweepDestination: hub ?? "None observed",
    isSweeperActive,
    sweepVelocitySeconds: velocityMedian,
    forensicTraceNotes: notes,
    moneyTrailGraph: {
      upstreamFunder: seedFunder ?? "None observed",
      funderType,
      target,
      downstreamHub: hub ?? "None observed",
      hubType,
    },
    analysisStatus: gaps.length > 0 ? "partial" : "completed",
    velocitySamples,
    retainedRatio,
    funderProfile: funderType,
    hubProfile: hubType,
    hop2Funder,
    sampledTransactions: allTx.length,
    recentRapidForwarding,
    recentDeltas: recentWindow,
  };
}
