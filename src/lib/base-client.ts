import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export const BASE_RPC_URL =
  process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";

export const baseClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL, {
    timeout: 12_000,
    retryCount: 2,
    retryDelay: 500,
  }),
});
