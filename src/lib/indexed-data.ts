import type { Address } from "viem";
import {
  getBlockscoutContractCreation,
  getBlockscoutRecentTransactions,
  isBlockscoutConfigured,
} from "./blockscout-client";
import {
  ExplorerUnavailableError,
  getContractCreation,
  getRecentTransactions,
  isExplorerConfigured,
  type ContractCreation,
  type IndexedTransaction,
} from "./etherscan-client";

export type IndexedProvider = "blockscout-pro" | "etherscan-v2";

export interface ProviderResult<T> {
  provider: IndexedProvider;
  data: T;
}

export interface IndexedHistoryResult
  extends ProviderResult<IndexedTransaction[]> {
  method: string;
}

type ProviderAttempt<T> = {
  provider: IndexedProvider;
  configured: () => boolean;
  run: () => Promise<T>;
};

async function attemptProviders<T>(
  attempts: ProviderAttempt<T>[],
  evidenceName: string,
): Promise<ProviderResult<T>> {
  const configured = attempts.filter((attempt) => attempt.configured());
  if (configured.length === 0) {
    throw new ExplorerUnavailableError(
      "missing-key",
      `${evidenceName} needs a server-side Blockscout API key (recommended) or an Etherscan key with Base API access.`,
    );
  }

  const errors: string[] = [];
  for (const attempt of configured) {
    try {
      return { provider: attempt.provider, data: await attempt.run() };
    } catch (error) {
      errors.push(
        `${attempt.provider}: ${
          error instanceof Error ? error.message : "request failed"
        }`,
      );
    }
  }

  throw new ExplorerUnavailableError(
    "api-error",
    `${evidenceName} was unavailable from every configured provider. ${errors.join(" | ")}`,
  );
}

export async function getIndexedContractCreation(
  address: Address,
): Promise<ProviderResult<ContractCreation>> {
  return attemptProviders(
    [
      {
        provider: "blockscout-pro",
        configured: isBlockscoutConfigured,
        run: () => getBlockscoutContractCreation(address),
      },
      {
        provider: "etherscan-v2",
        configured: isExplorerConfigured,
        run: () => getContractCreation(address),
      },
    ],
    "Contract creation evidence",
  );
}

export async function getIndexedRecentTransactions(
  address: Address,
  limit = 10,
): Promise<IndexedHistoryResult> {
  const result = await attemptProviders(
    [
      {
        provider: "blockscout-pro" as const,
        configured: isBlockscoutConfigured,
        run: () => getBlockscoutRecentTransactions(address, limit),
      },
      {
        provider: "etherscan-v2" as const,
        configured: isExplorerConfigured,
        run: async () => ({
          transactions: await getRecentTransactions(address, limit),
          method: "account.txlist" as const,
        }),
      },
    ],
    "Recent transaction evidence",
  );

  return {
    provider: result.provider,
    data: result.data.transactions,
    method: result.data.method,
  };
}
