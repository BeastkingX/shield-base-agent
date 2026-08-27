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

vi.mock("./approvals", () => ({
  fetchApprovalsForWallet: vi.fn().mockResolvedValue({
    approvals: [],
    totalCount: 0,
    unlimitedCount: 0,
    highRiskCount: 0,
    uniqueTokensCount: 0,
    uniqueSpendersCount: 0,
  }),
}));

vi.mock("./cluster-detector", () => ({
  analyzeClusterTaint: vi.fn().mockResolvedValue({
    targetAddress: "0x1111111111111111111111111111111111111111",
    hasTaint: false,
    taintSeverity: "none",
    clusterTaintName: null,
    seedFunder: "None observed",
    sweepDestination: "None observed",
    isSweeperActive: false,
    sweepVelocitySeconds: null,
    forensicTraceNotes: ["No rapid-forwarding or cluster pattern measured in the sampled history."],
    moneyTrailGraph: {
      upstreamFunder: "None observed",
      funderType: "Clean / Normal Funder",
      target: "0x1111111111111111111111111111111111111111",
      downstreamHub: "None observed",
      hubType: "No outbound forwarding observed",
    },
    analysisStatus: "completed",
    velocitySamples: 0,
    retainedRatio: null,
    funderProfile: "No dispenser pattern measured",
    hubProfile: "No aggregator pattern measured",
    hop2Funder: null,
    sampledTransactions: 0,
  }),
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
    expect(receipt.coverage).toEqual({ completed: 6, unavailable: 3, total: 9 });
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
    expect(receipt.coverage).toEqual({ completed: 9, unavailable: 0, total: 9 });
    expect(receipt.verdict).toBe("LOW OBSERVED RISK");
  });

  it("classifies an EIP-7702 delegation designator as a delegated wallet", async () => {
    const delegatedWallet =
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
    vi.mocked(baseClient.getCode).mockResolvedValue(
      "0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d" as Hex,
    );
    vi.mocked(getIndexedRecentTransactions).mockResolvedValue({
      provider: "blockscout-pro",
      data: [],
      method: "account.txlist",
    });

    const receipt = await runShieldScan(delegatedWallet);
    const identity = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_TARGET_TYPE",
    );

    expect(receipt.targetType).toBe("wallet");
    expect(identity).toMatchObject({
      status: "pass",
      label: "EIP-7702 delegated wallet detected",
    });
    expect(identity?.facts?.["Classification"]).toBe(
      "Delegated wallet (EIP-7702)",
    );
    expect(identity?.facts?.["Delegation target"]).toBe(
      "0x5A7FC11397E9a8AD41BF10bf13F22B0a63f96f6d",
    );
    expect(getContractSourceMetadata).not.toHaveBeenCalled();
    expect(getIndexedContractCreation).not.toHaveBeenCalled();
    expect(baseClient.getStorageAt).not.toHaveBeenCalled();
    expect(receipt.coverage).toEqual({ completed: 8, unavailable: 0, total: 8 });
    expect(receipt.verdict).toBe("LOW OBSERVED RISK");
  });

  it("surfaces explorer-reported proxies even without an EIP-1967 slot value", async () => {
    vi.mocked(getContractSourceMetadata).mockResolvedValue({
      SourceCode: "contract Proxy {}",
      ABI: "[]",
      ContractName: "FiatTokenProxy",
      CompilerVersion: "v0.6.12",
      CompilerType: "solc",
      OptimizationUsed: "1",
      Runs: "10000000",
      EVMVersion: "Default",
      LicenseType: "None",
      Proxy: "1",
      Implementation: "0x2222222222222222222222222222222222222222",
      SimilarMatch: "",
      verified: true,
    });
    vi.mocked(getIndexedContractCreation).mockResolvedValue({
      provider: "blockscout-pro",
      data: {
        contractAddress: ADDRESS,
        contractCreator: "0x3333333333333333333333333333333333333333",
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: "100",
        timestamp: "1700000000",
        contractFactory: "",
      },
    });
    vi.mocked(getIndexedRecentTransactions).mockResolvedValue({
      provider: "blockscout-pro",
      data: [],
      method: "account.txlist",
    });

    const receipt = await runShieldScan(ADDRESS);
    const slotEvidence = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_PROXY_IMPLEMENTATION",
    );
    const sourceEvidence = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_CONTRACT_VERIFICATION",
    );

    expect(slotEvidence).toMatchObject({
      status: "pass",
      label: "No EIP-1967 implementation found",
    });
    expect(sourceEvidence).toMatchObject({
      status: "pass",
      label: "Published source verified; proxy reported",
    });
    expect(sourceEvidence?.facts?.["Implementation"]).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(receipt.verdict).toBe("LOW OBSERVED RISK");
  });

  it("surfaces third-party threat intelligence from GoPlus on wallet targets", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("gopluslabs.io")) {
        return new Response(
          JSON.stringify({
            code: 1,
            message: "ok",
            result: {
              phishing_activities: "1",
              stealing_attack: "0",
              data_source: "GoPlus Lab",
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "1", message: "OK", result: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.mocked(baseClient.getCode).mockResolvedValue("0x" as Hex);
    vi.mocked(getIndexedRecentTransactions).mockResolvedValue({
      provider: "blockscout-pro",
      data: [],
      method: "account.txlist",
    });

    const receipt = await runShieldScan(ADDRESS);
    const threatIntel = receipt.evidence.find(
      (item) => item.id === "EVIDENCE_THREAT_INTEL",
    );

    expect(threatIntel).toMatchObject({
      status: "danger",
      source: "goplus-address-security",
    });
    expect(threatIntel?.facts?.["Danger flags"]).toContain("phishing_activities");
    expect(receipt.verdict).toBe("HIGH OBSERVED RISK");
  });
});
