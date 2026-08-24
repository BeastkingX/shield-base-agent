import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBlockscoutContractCreation,
  getBlockscoutRecentTransactions,
} from "./blockscout-client";

const ADDRESS = "0x4200000000000000000000000000000000000006" as Address;
const HASH = `0x${"b".repeat(64)}`;

function compatibilityTransaction() {
  return {
    blockNumber: "123",
    timeStamp: "1787530353",
    hash: HASH,
    from: "0x0000000000000000000000000000000000000001",
    to: ADDRESS,
    value: "5",
    isError: "0",
    txreceipt_status: "1",
    methodId: "0xd0e30db0",
    functionName: "deposit()",
  };
}

function restTransaction() {
  return {
    block_number: 123,
    timestamp: "2026-08-24T00:12:33.000Z",
    hash: HASH,
    from: { hash: "0x0000000000000000000000000000000000000001" },
    to: { hash: ADDRESS },
    value: "5",
    status: "ok",
    method: "deposit",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Blockscout PRO client", () => {
  it("does not make a request when the server key is missing", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "missing-key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retrieves Base contract creation through the universal endpoint", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "1",
          message: "OK",
          result: [
            {
              contractAddress: ADDRESS,
              contractCreator: "0x0000000000000000000000000000000000000001",
              txHash: `0x${"a".repeat(64)}`,
              blockNumber: "1",
              timestamp: "1700000000",
              contractFactory: "",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getBlockscoutContractCreation(ADDRESS);
    expect(result.blockNumber).toBe("1");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.blockscout.com/v2/api",
    );
    expect(requestUrl.searchParams.get("chain_id")).toBe("8453");
    expect(requestUrl.searchParams.get("apikey")).toBe("proapi_test");
  });

  it("uses compatibility transaction history when that route succeeds", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "1",
          message: "OK",
          result: [compatibilityTransaction()],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).resolves.toMatchObject({
      method: "account.txlist",
      transactions: [compatibilityTransaction()],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/v2/api");
  });

  it("recovers through modern REST after compatibility history returns HTTP 500", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [restTransaction()], next_page_params: null }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getBlockscoutRecentTransactions(ADDRESS);
    expect(result.method).toBe("REST /addresses/{address}/transactions");
    expect(result.transactions[0]).toMatchObject({
      blockNumber: "123",
      timeStamp: "1787530353",
      to: ADDRESS,
      isError: "0",
      txreceipt_status: "1",
      functionName: "deposit",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(requestUrl.pathname).toBe(
      `/8453/api/v2/addresses/${ADDRESS}/transactions`,
    );
    expect(requestUrl.searchParams.get("apikey")).toBe("proapi_test");
  });

  it("treats an empty REST items list as completed empty history", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ items: [], next_page_params: null }),
            { status: 200 },
          ),
        ),
    );

    await expect(getBlockscoutRecentTransactions(ADDRESS)).resolves.toEqual({
      transactions: [],
      method: "REST /addresses/{address}/transactions",
    });
  });

  it("rejects malformed responses from both transaction routes", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ bad: true }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "api-error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports both route failures without converting them into risk evidence", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response("error", { status: 503 })),
    );

    await expect(getBlockscoutRecentTransactions(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "api-error",
      message: expect.stringContaining("Both Blockscout transaction routes failed"),
    });
  });
});
