import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export const BASE_RPC_URL =
  process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";

/**
 * Base RPC client with tight timeouts so a stalled RPC does not cause the
 * Vercel function to exceed maxDuration and return a non-JSON platform error.
 * Previous 12s x 3 attempts could alone exceed 30s; now 6s x 2 attempts.
 */
export const baseClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL, {
    timeout: 6_000,
    retryCount: 1,
    retryDelay: 400,
  }),
});
