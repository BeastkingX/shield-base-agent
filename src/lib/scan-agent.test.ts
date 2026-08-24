import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

vi.mock("./base-client", () => ({
  baseClient: {
    getChainId: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    getCode: vi.fn(),
    getBalance: vi.fn(),
    getTransactionCount: vi.fn(),
    getStorageAt: vi.fn(),
  },
}));

vi.mock("./etherscan-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./etherscan-client")>();
  return {
    ...original,
    getContractSourceMetadata: vi.fn(),
  };
});

vi.mock("./indexed-data", () => ({
  getIndexedContractCreation: vi.fn(),
  getIndexedRecentTransactions: vi.fn(),
}));

import { baseClient } from "./base-client";
import {
  ExplorerUnavailableError,
  getContractSourceMetadata,
} from "./etherscan-client";
import {
  getIndexedContractCreation,
  getIndexedRecentTransactions,
} from "./indexed-data";
import { runShieldScan } from "./scan-agent";

const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(baseClient.getChainId).mockResolvedValue(8453);
  vi.mocked(baseClient.getBlockNumber).mockResolvedValue(BigInt("123456"));
  vi.mocked(baseClient.getBlock).mockResolvedValue({
    timestamp: BigInt("1777000000"),
  } as Awaited<ReturnType<typeof baseClient.getBlock>>);
  vi.mocked(baseClient.getCode).mockResolvedValue("0x60006000" as Hex);
  vi.mocked(baseClient.getBalance).mockResolvedValue(
    BigInt("1000000000000000000"),
  );
  vi.mocked(baseClient.getTransactionCount).mockResolvedValue(25);
  vi.mocked(baseClient.getStorageAt).mockResolvedValue(
    `0x${"0".repeat(64)}` as Hex,
  );
});

describe("Shield scan orchestration", () => {
  it("returns an honest partial receipt when explorer access is missing", async () => {
    const missingKey = new ExplorerUnavailableError(
      "missing-key",
      "The Etherscan API key is not configured.",
    );
    vi.mocked(getContractSourceMetadata).mockRejectedValue(missingKey);
    vi.mocked(getIndexedContractCreation).mockRejectedValue(missingKey);
    vi.mocked(getIndexedRecentTransactions).mockRejectedValue(missingKey);

    const receipt = await runShieldScan(ADDRESS);
    const indexedItems = receipt.evidence.filter((item) =>
      ["etherscan-v2", "indexed-provider-fallback"].includes(item.source),
    );

    expect(receipt.targetType).toBe("contract");
    expect(receipt.verdict).toBe("INSUFFICIENT DATA");
    expect(receipt.coverage).toEqual({ completed: 5, unavailable: 3, total: 8 });
    expect(indexedItems).toHaveLength(3);
    expect(indexedItems.every((item) => item.status === "unavailable")).toBe(true);
    expect(
      receipt.evidence
        .find((item) => item.id === "EVIDENCE_RECENT_ACTIVITY")
        ?.limitations.join(" "),
    ).toContain("server-side Blockscout API key");
  });

  it("uses official predeploy provenance instead of inventing a WETH creation transaction", async () => {
    vi.mocked(getContractSourceMetadata).mockResolvedValue({
      SourceCode: "contract WETH9 {}",
      ABI: "[]",
      ContractName: "WETH9",
      CompilerVersion: "v0.5.17",
      CompilerType: "solc",
      OptimizationUsed: "0",
      Runs: "0",
      EVMVersion: "Default",
      LicenseType: "GNU LGPLv3",
      Proxy: "0",
      Implementation: "",
      SimilarMatch: "",
      verified: true,
    });
    vi.mocked(getIndexedRecentTransactions).mockResolvedValue({
      provider: "blockscout-pro",
      data: [],
      method: "REST /addresses/{address}/transactions",
    });

    const receipt = await runShieldScan(WETH);
    const deployment = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_CONTRACT_CREATION",
    );
    const activity = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_RECENT_ACTIVITY",
    );

    expect(getIndexedContractCreation).not.toHaveBeenCalled();
    expect(deployment).toMatchObject({
      status: "pass",
      source: "base-official-registry",
      rawValue: "protocol-predeploy:WETH9",
    });
    expect(deployment?.facts?.["Ordinary creation transaction"]).toBe(
      "Not applicable",
    );
    expect(activity?.method).toBe(
      "REST /addresses/{address}/transactions",
    );
    expect(receipt.coverage).toEqual({ completed: 8, unavailable: 0, total: 8 });
    expect(receipt.verdict).toBe("LOW OBSERVED RISK");
  });
});
