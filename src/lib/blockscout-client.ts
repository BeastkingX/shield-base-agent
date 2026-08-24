import type { Address } from "viem";
import { z } from "zod";
import {
  ExplorerUnavailableError,
  type ContractCreation,
  type IndexedTransaction,
} from "./etherscan-client";

const BLOCKSCOUT_PRO_URL = "https://api.blockscout.com/v2/api";
const BLOCKSCOUT_REST_URL = "https://api.blockscout.com/8453/api/v2";
const BASE_CHAIN_ID = "8453";

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

async function fetchJson(url: URL, routeName: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ExplorerUnavailableError(
      "request-failed",
      `${routeName} timed out or could not connect.`,
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
  options: { allowEmptyResult?: boolean } = {},
): Promise<unknown> {
  const url = new URL(BLOCKSCOUT_PRO_URL);
  url.searchParams.set("chain_id", BASE_CHAIN_ID);
  url.searchParams.set("apikey", apiKey());
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  const body = await fetchJson(url, "Blockscout compatibility API");
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
): Promise<IndexedTransaction[]> {
  const url = new URL(
    `${BLOCKSCOUT_REST_URL}/addresses/${address}/transactions`,
  );
  url.searchParams.set("apikey", apiKey());

  const body = await fetchJson(url, "Blockscout REST API");
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
  apiKey();
  const failures: string[] = [];

  try {
    const result = await callBlockscout(
      {
        module: "account",
        action: "txlist",
        address,
        startblock: "0",
        endblock: "9999999999",
        page: "1",
        offset: String(limit),
        sort: "desc",
      },
      { allowEmptyResult: true },
    );
    const parsed = z.array(transactionSchema).safeParse(result);
    if (!parsed.success) {
      throw new ExplorerUnavailableError(
        "invalid-response",
        "Compatibility transaction history had an unexpected format.",
      );
    }
    return {
      transactions: parsed.data,
      method: "account.txlist",
    };
  } catch (error) {
    failures.push(
      `compatibility: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  try {
    return {
      transactions: await getBlockscoutRestTransactions(address, limit),
      method: "REST /addresses/{address}/transactions",
    };
  } catch (error) {
    failures.push(
      `REST: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  throw new ExplorerUnavailableError(
    "api-error",
    `Both Blockscout transaction routes failed. ${failures.join(" | ")}`,
  );
}
