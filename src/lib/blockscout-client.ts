import type { Address } from "viem";
import { z } from "zod";
import {
  ExplorerUnavailableError,
  type ContractCreation,
  type IndexedTransaction,
} from "./etherscan-client";
import { fetchWithRetry } from "./retry";
import { getCachedTxs, setCachedTxs } from "./tx-cache";

const BLOCKSCOUT_PRO_URL = "https://api.blockscout.com/v2/api";
const BLOCKSCOUT_REST_URL = "https://api.blockscout.com/8453/api/v2";
/**
 * Public, keyless Blockscout compatibility endpoint. Used exactly once as a
 * fallback after the keyed compatibility route has failed, because a rate
 * limited or erroring paid key should not cost the scan its activity evidence.
 */
const BLOCKSCOUT_KEYLESS_URL = "https://base.blockscout.com/api";
const BASE_CHAIN_ID = "8453";

/** Per-attempt network timeout for history routes. Reduced to stay inside Vercel budget. */
const ATTEMPT_TIMEOUT_MS = 5_000;
/**
 * Shared wall-clock budget for every Blockscout route inside one call, so the
 * retry policy can never outlast the API route's `maxDuration`.
 * Reduced from 12s to 8s to prevent platform non-JSON timeouts; with partial-mode
 * rescue the scan can still return HIGH from threat intel even if this window fails.
 */
const ROUTE_BUDGET_MS = 10_000;

const envelopeSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.unknown(),
});

const creationSchema = z.object({
  contractAddress: z.string(),
  contractCreator: z.string(),
  txHash: z.string(),
  blockNumber: z.string(),
  timestamp: z.string(),
  contractFactory: z.string().default(""),
});

const transactionSchema = z.object({
  blockNumber: z.string(),
  timeStamp: z.string(),
  hash: z.string(),
  from: z.string(),
  to: z.string().default(""),
  value: z.string().default("0"),
  isError: z.string().default("0"),
  txreceipt_status: z.string().default(""),
  methodId: z.string().default(""),
  functionName: z.string().default(""),
});

const restAddressSchema = z.object({ hash: z.string() });
const restTransactionSchema = z.object({
  block_number: z.union([z.number(), z.string()]),
  timestamp: z.string(),
  hash: z.string(),
  from: restAddressSchema,
  to: restAddressSchema.nullable().optional(),
  value: z.string().default("0"),
  status: z.string(),
  method: z.string().nullable().optional(),
});
const restTransactionsSchema = z.object({
  items: z.array(restTransactionSchema),
});

export interface BlockscoutTransactionHistory {
  transactions: IndexedTransaction[];
  method:
    | "account.txlist"
    | "REST /addresses/{address}/transactions";
}

export function isBlockscoutConfigured(): boolean {
  return Boolean(process.env.BLOCKSCOUT_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.BLOCKSCOUT_API_KEY?.trim();
  if (!key) {
    throw new ExplorerUnavailableError(
      "missing-key",
      "The Blockscout API key is not configured.",
    );
  }
  return key;
}

async function fetchJson(
  url: URL,
  routeName: string,
  options: { deadlineAt?: number; attempts?: number } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      { cache: "no-store" },
      {
        timeoutMs: ATTEMPT_TIMEOUT_MS,
        deadlineAt: options.deadlineAt,
        attempts: options.attempts,
        label: routeName,
      },
    );
  } catch (error) {
    throw new ExplorerUnavailableError(
      "request-failed",
      `${routeName} timed out or could not connect. ${
        error instanceof Error ? error.message : "request failed"
      }`,
    );
  }

  if (!response.ok) {
    throw new ExplorerUnavailableError(
      "request-failed",
      `${routeName} returned HTTP ${response.status}.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ExplorerUnavailableError(
      "invalid-response",
      `${routeName} did not return valid JSON.`,
    );
  }
}

async function callBlockscout(
  parameters: Record<string, string>,
  options: {
    allowEmptyResult?: boolean;
    keyless?: boolean;
    deadlineAt?: number;
    attempts?: number;
  } = {},
): Promise<unknown> {
  const keyless = options.keyless === true;
  const url = new URL(keyless ? BLOCKSCOUT_KEYLESS_URL : BLOCKSCOUT_PRO_URL);

  if (!keyless) {
    url.searchParams.set("chain_id", BASE_CHAIN_ID);
    url.searchParams.set("apikey", apiKey());
  }

  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  const body = await fetchJson(
    url,
    keyless
      ? "Blockscout keyless compatibility API"
      : "Blockscout compatibility API",
    { deadlineAt: options.deadlineAt, attempts: options.attempts },
  );
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "Blockscout compatibility API returned an unexpected response.",
    );
  }

  const emptyResult =
    Array.isArray(parsed.data.result) && parsed.data.result.length === 0;
  const noTransactions = /no transactions found/i.test(
    `${parsed.data.message} ${String(parsed.data.result)}`,
  );

  if (parsed.data.status !== "1") {
    if (options.allowEmptyResult && (emptyResult || noTransactions)) return [];
    throw new ExplorerUnavailableError(
      "api-error",
      typeof parsed.data.result === "string"
        ? parsed.data.result
        : parsed.data.message || "Blockscout rejected the request.",
    );
  }

  return parsed.data.result;
}

function unixSeconds(timestamp: string): string {
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds)
    ? Math.floor(milliseconds / 1000).toString()
    : "";
}

async function getBlockscoutRestTransactions(
  address: Address,
  limit: number,
  deadlineAt?: number,
): Promise<IndexedTransaction[]> {
  const url = new URL(
    `${BLOCKSCOUT_REST_URL}/addresses/${address}/transactions`,
  );
  const key = process.env.BLOCKSCOUT_API_KEY?.trim();
  if (key) url.searchParams.set("apikey", key);

  const body = await fetchJson(url, "Blockscout REST API", { deadlineAt });
  const parsed = restTransactionsSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "Blockscout REST transaction history had an unexpected format.",
    );
  }

  return parsed.data.items.slice(0, limit).map((transaction) => {
    const normalizedStatus = transaction.status.toLowerCase();
    const failed = normalizedStatus === "error";
    const succeeded = normalizedStatus === "ok" || normalizedStatus === "success";
    const method = transaction.method ?? "";

    return {
      blockNumber: String(transaction.block_number),
      timeStamp: unixSeconds(transaction.timestamp),
      hash: transaction.hash,
      from: transaction.from.hash,
      to: transaction.to?.hash ?? "",
      value: transaction.value,
      isError: failed ? "1" : "0",
      txreceipt_status: failed ? "0" : succeeded ? "1" : "",
      methodId: method.startsWith("0x") ? method : "",
      functionName: method.startsWith("0x") ? "" : method,
    };
  });
}

export async function getBlockscoutContractCreation(
  address: Address,
): Promise<ContractCreation> {
  const result = await callBlockscout({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
  });
  const parsed = z.array(creationSchema).safeParse(result);
  if (!parsed.success || !parsed.data[0]) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "Contract creation metadata was missing from the Blockscout response.",
    );
  }
  return parsed.data[0];
}

export async function getBlockscoutRecentTransactions(
  address: Address,
  limit = 10,
): Promise<BlockscoutTransactionHistory> {
  // Serve from the shared cache so the wallet-history evidence and the cluster
  // detector never hit Blockscout twice for the same recent window.
  const cached = getCachedTxs(address, "desc", limit);
  if (cached) {
    return {
      transactions: cached as IndexedTransaction[],
      method: "account.txlist",
    };
  }
  apiKey();
  const failures: string[] = [];
  // One shared budget across all three routes keeps the retry policy inside
  // the API route's maxDuration.
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  const txlistParameters = {
    module: "account",
    action: "txlist",
    address,
    startblock: "0",
    endblock: "9999999999",
    page: "1",
    offset: String(limit),
    sort: "desc",
  };

  const parseTxList = (result: unknown): IndexedTransaction[] => {
    const parsed = z.array(transactionSchema).safeParse(result);
    if (!parsed.success) {
      throw new ExplorerUnavailableError(
        "invalid-response",
        "Compatibility transaction history had an unexpected format.",
      );
    }
    return parsed.data;
  };

  // Route 1: keyed compatibility API, with the full retry policy.
  try {
    const transactions = parseTxList(
      await callBlockscout(txlistParameters, {
        allowEmptyResult: true,
        deadlineAt,
      }),
    );
    setCachedTxs(address, "desc", transactions);
    return { transactions, method: "account.txlist" };
  } catch (error) {
    failures.push(
      `compatibility: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  // Route 2: keyless public compatibility endpoint, tried exactly once. A
  // rate-limited or failing paid key must not cost the scan its activity data.
  try {
    return {
      transactions: parseTxList(
        await callBlockscout(txlistParameters, {
          allowEmptyResult: true,
          keyless: true,
          attempts: 1,
          deadlineAt,
        }),
      ),
      method: "account.txlist",
    };
  } catch (error) {
    failures.push(
      `keyless-compatibility: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  // Route 3: modern REST API.
  try {
    return {
      transactions: await getBlockscoutRestTransactions(
        address,
        limit,
        deadlineAt,
      ),
      method: "REST /addresses/{address}/transactions",
    };
  } catch (error) {
    failures.push(
      `REST: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  throw new ExplorerUnavailableError(
    "api-error",
    `All three Blockscout transaction routes failed. ${failures.join(" | ")}`,
  );
}
