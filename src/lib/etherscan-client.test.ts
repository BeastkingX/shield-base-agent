import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  ExplorerUnavailableError,
  getContractSourceMetadata,
  getRecentTransactions,
} from "./etherscan-client";

const ADDRESS = "0x4200000000000000000000000000000000000006" as Address;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Etherscan V2 client", () => {
  it("returns an explicit missing-key state before making a request", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getContractSourceMetadata(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "missing-key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes verified contract metadata", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "1",
            message: "OK",
            result: [
              {
                SourceCode: "contract WrappedEther {}",
                ABI: "[]",
                ContractName: "WrappedEther",
                CompilerVersion: "v0.8.15",
                Proxy: "0",
                Implementation: "",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await getContractSourceMetadata(ADDRESS);
    expect(result.verified).toBe(true);
    expect(result.ContractName).toBe("WrappedEther");
  });

  it("surfaces provider errors without hiding them as empty evidence", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "0",
            message: "NOTOK",
            result: "Max rate limit reached",
          }),
          { status: 200 },
        ),
      ),
    );

    try {
      await getRecentTransactions(ADDRESS);
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ExplorerUnavailableError);
      expect(error).toMatchObject({ code: "api-error" });
    }
  });

  it("accepts the explorer's no-transactions response as completed empty history", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "0",
            message: "No transactions found",
            result: [],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(getRecentTransactions(ADDRESS)).resolves.toEqual([]);
  });
});
