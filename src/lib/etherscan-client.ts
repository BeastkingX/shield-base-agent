import type { Address } from "viem";
import { z } from "zod";

const ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api";
const BASE_CHAIN_ID = "8453";

const envelopeSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.unknown(),
});

const sourceMetadataSchema = z.object({
  SourceCode: z.string().default(""),
  ABI: z.string().default(""),
  ContractName: z.string().default(""),
  CompilerVersion: z.string().default(""),
  CompilerType: z.string().default(""),
  OptimizationUsed: z.string().default(""),
  Runs: z.string().default(""),
  EVMVersion: z.string().default(""),
  LicenseType: z.string().default(""),
  Proxy: z.string().default("0"),
  Implementation: z.string().default(""),
  SimilarMatch: z.string().default(""),
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

export type SourceMetadata = z.infer<typeof sourceMetadataSchema> & {
  verified: boolean;
};
export type ContractCreation = z.infer<typeof creationSchema>;
export type IndexedTransaction = z.infer<typeof transactionSchema>;

export type ExplorerErrorCode =
  | "missing-key"
  | "request-failed"
  | "api-error"
  | "invalid-response";

export class ExplorerUnavailableError extends Error {
  constructor(
    public readonly code: ExplorerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExplorerUnavailableError";
  }
}

export function isExplorerConfigured(): boolean {
  return Boolean(process.env.ETHERSCAN_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) {
    throw new ExplorerUnavailableError(
      "missing-key",
      "The Etherscan API key is not configured.",
    );
  }
  return key;
}

async function callEtherscan(
  parameters: Record<string, string>,
  options: { allowEmptyResult?: boolean } = {},
): Promise<unknown> {
  const url = new URL(ETHERSCAN_V2_URL);
  url.searchParams.set("chainid", BASE_CHAIN_ID);
  url.searchParams.set("apikey", apiKey());
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ExplorerUnavailableError(
      "request-failed",
      "The indexed-data request timed out or could not connect.",
    );
  }

  if (!response.ok) {
    throw new ExplorerUnavailableError(
      "request-failed",
      `The indexed-data service returned HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "The indexed-data service did not return valid JSON.",
    );
  }

  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "The indexed-data service returned an unexpected response.",
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
        : parsed.data.message || "The indexed-data service rejected the request.",
    );
  }

  return parsed.data.result;
}

export async function getContractSourceMetadata(
  address: Address,
): Promise<SourceMetadata> {
  const result = await callEtherscan({
    module: "contract",
    action: "getsourcecode",
    address,
  });
  const parsed = z.array(sourceMetadataSchema).safeParse(result);
  if (!parsed.success || !parsed.data[0]) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "Contract source metadata was missing from the explorer response.",
    );
  }

  const metadata = parsed.data[0];
  const verified =
    metadata.SourceCode.trim().length > 0 &&
    !/not verified/i.test(metadata.ABI);

  return { ...metadata, verified };
}

export async function getContractCreation(
  address: Address,
): Promise<ContractCreation> {
  const result = await callEtherscan({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
  });
  const parsed = z.array(creationSchema).safeParse(result);
  if (!parsed.success || !parsed.data[0]) {
    throw new ExplorerUnavailableError(
      "invalid-response",
      "Contract creation metadata was missing from the explorer response.",
    );
  }
  return parsed.data[0];
}

export async function getRecentTransactions(
  address: Address,
  limit = 10,
): Promise<IndexedTransaction[]> {
  const result = await callEtherscan(
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
      "Transaction history did not match the expected explorer format.",
    );
  }
  return parsed.data;
}
