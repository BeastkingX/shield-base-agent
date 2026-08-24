import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./blockscout-client", () => ({
  isBlockscoutConfigured: vi.fn(),
  getBlockscoutContractCreation: vi.fn(),
  getBlockscoutRecentTransactions: vi.fn(),
}));

vi.mock("./etherscan-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./etherscan-client")>();
  return {
    ...original,
    isExplorerConfigured: vi.fn(),
    getContractCreation: vi.fn(),
    getRecentTransactions: vi.fn(),
  };
});

import {
  getBlockscoutContractCreation,
  isBlockscoutConfigured,
} from "./blockscout-client";
import {
  ExplorerUnavailableError,
  getContractCreation,
  isExplorerConfigured,
  type ContractCreation,
} from "./etherscan-client";
import { getIndexedContractCreation } from "./indexed-data";

const ADDRESS = "0x4200000000000000000000000000000000000006" as Address;
const CREATION: ContractCreation = {
  contractAddress: ADDRESS,
  contractCreator: "0x0000000000000000000000000000000000000001",
  txHash: `0x${"a".repeat(64)}`,
  blockNumber: "1",
  timestamp: "1700000000",
  contractFactory: "",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("indexed provider selection", () => {
  it("prefers Blockscout for Base indexed history when both providers exist", async () => {
    vi.mocked(isBlockscoutConfigured).mockReturnValue(true);
    vi.mocked(isExplorerConfigured).mockReturnValue(true);
    vi.mocked(getBlockscoutContractCreation).mockResolvedValue(CREATION);

    await expect(getIndexedContractCreation(ADDRESS)).resolves.toEqual({
      provider: "blockscout-pro",
      data: CREATION,
    });
    expect(getContractCreation).not.toHaveBeenCalled();
  });

  it("falls back to Etherscan if a configured Blockscout request fails", async () => {
    vi.mocked(isBlockscoutConfigured).mockReturnValue(true);
    vi.mocked(isExplorerConfigured).mockReturnValue(true);
    vi.mocked(getBlockscoutContractCreation).mockRejectedValue(
      new ExplorerUnavailableError("request-failed", "Blockscout unavailable"),
    );
    vi.mocked(getContractCreation).mockResolvedValue(CREATION);

    await expect(getIndexedContractCreation(ADDRESS)).resolves.toEqual({
      provider: "etherscan-v2",
      data: CREATION,
    });
  });

  it("returns an explicit unavailable state if neither provider is configured", async () => {
    vi.mocked(isBlockscoutConfigured).mockReturnValue(false);
    vi.mocked(isExplorerConfigured).mockReturnValue(false);

    await expect(getIndexedContractCreation(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "missing-key",
    });
  });
});
