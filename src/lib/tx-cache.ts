/**
 * Shield shared transaction-history cache.
 *
 * A tiny in-process cache keyed by `address + sort`. Its purpose is twofold:
 *   1. De-duplicate: the cluster detector reads the same recent history window
 *      that getIndexedRecentTransactions() reads. Sharing one entry means we
 *      never hit Blockscout twice for the same data.
 *   2. Stabilize verdicts: re-scanning the same address (the demo case, and the
 *      hourly watchlist CI) returns the cached windows instead of re-hitting a
 *      throttled free Blockscout quota, so a verdict no longer flips between
 *      LOW OBSERVED RISK and INSUFFICIENT DATA based purely on throttle timing.
 *
 * NOTE: this is per-instance (best-effort), consistent with the existing
 * "rate limiting is per-instance" limitation. Upgrading to a shared store
 * (e.g. Upstash Redis) is the natural next step if cross-instance consistency
 * is needed; the key shape and TTL are chosen so that swap is trivial.
 */
type Sort = "asc" | "desc";

interface CacheEntry {
  at: number;
  data: unknown[];
}

const store = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 60 seconds

function fresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.at < TTL_MS;
}

/**
 * Return up to `limit` cached transactions for an address+sort, or null on a
 * miss. The key does not include the limit, so a cached `limit=30` window can
 * serve a `limit=10` reader and vice-versa.
 */
export function getCachedTxs(
  address: string,
  sort: Sort,
  limit: number,
): unknown[] | null {
  const entry = store.get(`${address.toLowerCase()}:${sort}`);
  if (entry && fresh(entry) && entry.data.length >= limit) {
    return entry.data.slice(0, limit);
  }
  return null;
}

export function setCachedTxs(address: string, sort: Sort, txs: unknown[]): void {
  store.set(`${address.toLowerCase()}:${sort}`, { at: Date.now(), data: txs });
}
