import type { Address } from "viem";

/**
 * Shield Cluster Detector v2 — REAL implementation.
 *
 * What this module actually does (every claim below is computed, none is
 * scripted):
 *
 *   1. Reads the target's indexed transaction history on Base (Blockscout
 *      compatibility API: PRO key first, public endpoint as fallback).
 *   2. 1-hop upstream: identifies the earliest sampled inbound native
 *      funding transfer ("seed funder"), then profiles that funder for a
 *      measured gas-dispenser pattern (many tiny outbound transfers to many
 *      distinct addresses). Records the funder's own first funder (hop 2).
 *   3. 1-hop downstream: finds the dominant outflow destination and profiles
 *      it for a measured consolidation-hub pattern (inbound from many
 *      distinct sources in its recent window).
 *   4. Sweep velocity: pairs every sampled native deposit with the next
 *      subsequent outbound transfer and measures the delta in seconds.
 *      A median <= 30s over >= 2 samples is treated as automated sweeping.
 *   5. Deterministic severity. No named threat groups are ever asserted:
 *      labels describe measured behavior only. If data is missing the result
 *      says so; a clean result states what was actually checked.
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
  /** Measured median deposit-to-forward time in seconds (null = unmeasured). */
  sweepVelocitySeconds: number | null;
  forensicTraceNotes: string[];
  moneyTrailGraph: MoneyTrailGraph;
  // --- v2 additive measurement fields (safe: they ride into receipts) ---
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

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const PRO_COMPAT_URL = "https://api.blockscout.com/v2/api";
const PUBLIC_COMPAT_URL = "https://base.blockscout.com/api";
const BASE_CHAIN_ID = "8453";

/** A gas-top-up sized transfer (0.0005 ETH in wei). */
const GAS_HINT_WEI = BigInt("500000000000000");
/** Median deposit-to-forward time at or below this implies automation. */
const SWEEP_THRESHOLD_SECONDS = 30;
/** Anything above this and below 120s is "rapid forwarding", never critical. */
const RAPID_FORWARD_SECONDS = 120;
/** Minimum deposit/forward pairs before any velocity claim is made. */
const MIN_VELOCITY_SAMPLES = 2;
/** Window sizes per hop. */
const TARGET_WINDOW = 50;
const HOP_WINDOW = 25;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches one txlist page from the Blockscout compatibility API.
 * Uses the PRO endpoint when BLOCKSCOUT_API_KEY is configured; otherwise
 * falls back to the public endpoint (best effort, may be rate-limited).
 * Returns [] for addresses with no history. Throws after 2 failed attempts.
 */
async function fetchTxList(
  address: string,
  options: { sort?: "asc" | "desc"; offset?: number } = {},
): Promise<IndexedTx[]> {
  const { sort = "asc", offset = TARGET_WINDOW } = options;
  const apiKey = process.env.BLOCKSCOUT_API_KEY?.trim();
  const baseUrl = apiKey ? PRO_COMPAT_URL : PUBLIC_COMPAT_URL;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Short backoffs: worst-case degraded explorer adds ~1.7s to a scan.
    try {
      const url = new URL(baseUrl);
      if (apiKey) {
        url.searchParams.set("chain_id", BASE_CHAIN_ID);
        url.searchParams.set("apikey", apiKey);
      }
      url.searchParams.set("module", "account");
      url.searchParams.set("action", "txlist");
      url.searchParams.set("address", address);
      url.searchParams.set("startblock", "0");
      url.searchParams.set("endblock", "9999999999");
      url.searchParams.set("page", "1");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("sort", sort);

      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        status?: string;
        message?: string;
        result?: unknown;
      };
      if (body.status !== "1") {
        if (/no transactions found/i.test(body.message ?? "")) return [];
        throw new Error(
          typeof body.result === "string"
            ? body.result
            : body.message || "explorer rejected the request",
        );
      }
      if (!Array.isArray(body.result)) throw new Error("unexpected txlist shape");
      return body.result as IndexedTx[];
    } catch (error) {
      lastError = error;
      await sleep(attempt === 0 ? 500 : 1200);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("txlist failed");
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

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

/** ERC-20 sweep calls carry value 0 but still move assets out. */
const isTokenTransferCall = (tx: IndexedTx): boolean =>
  (tx.functionName ?? "").toLowerCase().startsWith("transfer") ||
  (tx.methodId ?? "").toLowerCase() === "0xa9059cbb";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function unavailableResult(target: Address, note: string): ClusterAnalysis {
  return {
    targetAddress: target,
    hasTaint: false,
    taintSeverity: "none",
    clusterTaintName: null,
    seedFunder: "Unknown — history unavailable",
    sweepDestination: "Unknown — history unavailable",
    isSweeperActive: false,
    sweepVelocitySeconds: null,
    forensicTraceNotes: [note],
    moneyTrailGraph: {
      upstreamFunder: "Unknown — history unavailable",
      funderType: "Unread",
      target,
      downstreamHub: "Unknown — history unavailable",
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

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export async function analyzeClusterTaint(
  targetAddress: Address,
): Promise<ClusterAnalysis> {
  const target = targetAddress.toLowerCase() as Address;
  const notes: string[] = [];
  const gaps: string[] = [];

  // --- Target history: ascending (genesis side) + descending (recent side)
  let earliest: IndexedTx[] = [];
  let recent: IndexedTx[] = [];
  try {
    earliest = await fetchTxList(target, { sort: "asc", offset: TARGET_WINDOW });
  } catch (error) {
    gaps.push(`earliest window unread (${error instanceof Error ? error.message : "failed"})`);
  }
  await sleep(300);
  try {
    recent = await fetchTxList(target, { sort: "desc", offset: TARGET_WINDOW });
  } catch (error) {
    gaps.push(`recent window unread (${error instanceof Error ? error.message : "failed"})`);
  }

  if (earliest.length === 0 && recent.length === 0 && gaps.length > 0) {
    return unavailableResult(
      targetAddress,
      "Indexed history was unavailable at scan time; money-trail checks did not run.",
    );
  }

  // Dedupe overlapping windows by hash.
  const seen = new Set<string>();
  const allTx = [...earliest, ...recent].filter((tx) => {
    if (!tx.hash || seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });
  const fullHistory = earliest.length < TARGET_WINDOW && gaps.length === 0;
  notes.push(
    `Sampled ${allTx.length} transaction(s) — ${
      fullHistory
        ? "this covers the full indexed history"
        : "windowed view; earliest history may extend beyond the sample"
    }.`,
  );

  const inboundNative = allTx
    .filter(
      (tx) => isSuccessful(tx) && sameAddress(tx.to, target) && txValue(tx) > BigInt(0),
    )
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
  const outbound = allTx.filter(
    (tx) =>
      isSuccessful(tx) &&
      sameAddress(tx.from, target) &&
      (txValue(tx) > BigInt(0) || isTokenTransferCall(tx)),
  );

  // --- 1-hop upstream: seed funder -----------------------------------------
  const seedTx = inboundNative[0];
  const seedFunder: string | null = seedTx ? seedTx.from : null;
  notes.push(
    seedTx
      ? `Earliest sampled inbound native funding: ${(
          Number(txValue(seedTx)) / 1e18
        ).toFixed(6)} ETH from ${seedFunder}${
          fullHistory ? " (genesis funder)" : ""
        }.`
      : "No inbound native funding observed in sampled history.",
  );

  // --- Hop 2: profile the seed funder and find its own funder --------------
  let funderType = "Unknown (no inbound funder)";
  let hop2Funder: string | null = null;
  if (seedFunder) {
    try {
      await sleep(300);
      const funderTxs = await fetchTxList(seedFunder, {
        sort: "asc",
        offset: HOP_WINDOW,
      });
      const funderOutbound = funderTxs.filter(
        (tx) =>
          isSuccessful(tx) && sameAddress(tx.from, seedFunder) && txValue(tx) > BigInt(0),
      );
      const tinyOutbound = funderOutbound.filter(
        (tx) => txValue(tx) <= GAS_HINT_WEI,
      );
      const distinctRecipients = new Set(
        tinyOutbound.map((tx) => (tx.to ?? "").toLowerCase()),
      );
      hop2Funder =
        funderTxs.find(
          (tx) =>
            isSuccessful(tx) && sameAddress(tx.to, seedFunder) && txValue(tx) > BigInt(0),
        )?.from ?? null;
      notes.push(
        `Hop-2: seed funder was itself first funded by ${hop2Funder ?? "not observed in window"}.`,
      );
      funderType =
        distinctRecipients.size >= 8 &&
        tinyOutbound.length / Math.max(funderOutbound.length, 1) >= 0.7
          ? `Gas-dispenser pattern (measured): ${distinctRecipients.size} distinct addresses funded with <=0.0005 ETH each in the sampled window.`
          : `No dispenser pattern measured (${funderOutbound.length} outbound, ${distinctRecipients.size} small-value recipients in window).`;
    } catch (error) {
      gaps.push(
        `funder hop unread (${error instanceof Error ? error.message : "failed"})`,
      );
      funderType = "Unread — funder history unavailable";
    }
  }

  // --- 1-hop downstream: dominant outflow hub --------------------------------
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
  let hubType = "No outbound forwarding observed";
  if (hub && outbound.length >= 3) {
    try {
      await sleep(300);
      const hubTxs = await fetchTxList(hub, { sort: "desc", offset: HOP_WINDOW });
      const distinctSources = new Set(
        hubTxs
          .filter((tx) => isSuccessful(tx) && sameAddress(tx.to, hub))
          .map((tx) => (tx.from ?? "").toLowerCase()),
      );
      hubType =
        distinctSources.size >= 8
          ? `Consolidation-hub pattern (measured): inbound from ${distinctSources.size} distinct sources in the recent window.`
          : `Top outflow destination (${rankedDestinations[0][1].count}/${outbound.length} sampled outbound); no aggregator pattern measured.`;
      notes.push(
        `Dominant outflow hub: ${hub} — destination of ${rankedDestinations[0][1].count} of ${outbound.length} sampled outbound transfers.`,
      );
    } catch (error) {
      gaps.push(
        `hub hop unread (${error instanceof Error ? error.message : "failed"})`,
      );
      hubType = "Unread — hub history unavailable";
    }
  }

  // --- Sweep velocity: deposit -> next forward delta -------------------------
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
      ? `Measured deposit-to-forward deltas (s): [${deltas.join(", ")}] — median ${velocityMedian}s over ${velocitySamples} sample(s).`
      : `Too few deposit/forward pairs to measure sweep velocity (${velocitySamples} sample(s) in window).`,
  );

  // --- Retained value --------------------------------------------------------
  const sumIn = inboundNative.reduce((acc, tx) => acc + txValue(tx), BigInt(0));
  const sumOut = outbound.reduce((acc, tx) => acc + txValue(tx), BigInt(0));
  const retainedRatio =
    sumIn > BigInt(0) ? Math.max(1 - Number(sumOut) / Number(sumIn), 0) : null;

  // --- Recency-aware sweep velocity ------------------------------------------
  const recentWindow = deltas.slice(-2);
  const recentRapidForwarding =
    recentWindow.length === 2 && recentWindow.every((d) => d <= 120);

  // --- Deterministic severity -------------------------------------------------
  const dispenser = funderType.startsWith("Gas-dispenser pattern");
  const aggregator = hubType.startsWith("Consolidation-hub pattern");
  let severity: ClusterAnalysis["taintSeverity"] = "none";
  let name: string | null = null;
  if (
    isSweeperActive &&
    (retainedRatio === null || retainedRatio < 0.2) &&
    (dispenser || aggregator)
  ) {
    severity = "critical";
    name = "Measured rapid-sweep compromise pattern";
  } else if (
    isSweeperActive ||
    (velocitySamples >= MIN_VELOCITY_SAMPLES &&
      velocityMedian !== null &&
      velocityMedian <= RAPID_FORWARD_SECONDS)
  ) {
    severity = "warning";
    name = "Automated forwarding pattern (measured, unattributed)";
  } else if (recentRapidForwarding && severity === "none") {
    severity = "warning";
    name = "Recent rapid-forwarding state change";
    notes.push(
      `Most recent deposits forwarded in ${recentWindow.join("s / ")}s — behavioral state change vs lifetime median (${velocityMedian}s).`,
    );
  }

  if (severity === "none") {
    notes.push("No rapid-forwarding or cluster pattern measured in the sampled history.");
  }
  if (gaps.length > 0) {
    notes.push(`Partial coverage: ${gaps.join(" | ")}`);
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
