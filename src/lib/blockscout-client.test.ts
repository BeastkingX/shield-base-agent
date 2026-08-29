import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBlockscoutContractCreation,
  getBlockscoutRecentTransactions,
} from "./blockscout-client";
import { setRetrySleepForTesting } from "./retry";

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
  setRetrySleepForTesting(null);
});

/** Compatibility-API envelope Blockscout returns for `status: "1"`. */
function compatEnvelope(result: unknown): Response {
  return new Response(
    JSON.stringify({ status: "1", message: "OK", result }),
    { status: 200 },
  );
}

/**
 * Answers per Blockscout route instead of per call sequence, so the assertions
 * stay readable now that a failing route is retried before falling through.
 */
function routeFetch(routes: {
  keyedCompat?: () => Response;
  keylessCompat?: () => Response;
  rest?: () => Response;
}) {
  const calls: string[] = [];
  const mock = vi.fn().mockImplementation(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.host === "api.blockscout.com" && url.pathname === "/v2/api") {
      calls.push("keyedCompat");
      return routes.keyedCompat?.() ?? new Response("no route", { status: 404 });
    }
    if (url.host === "base.blockscout.com" && url.pathname === "/api") {
      calls.push("keylessCompat");
      return (
        routes.keylessCompat?.() ?? new Response("no route", { status: 404 })
      );
    }
    if (url.host === "api.blockscout.com" && url.pathname.startsWith("/8453/")) {
      calls.push("rest");
      return routes.rest?.() ?? new Response("no route", { status: 404 });
    }
    calls.push(`unknown:${url.host}${url.pathname}`);
    return new Response("unknown route", { status: 404 });
  });

  return { mock, calls };
}

function countRoute(calls: string[], route: string): number {
  return calls.filter((call) => call === route).length;
}

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

  it("retries the keyed compatibility route, then the keyless route, then modern REST", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    setRetrySleepForTesting(async () => {});
    const { mock, calls } = routeFetch({
      keyedCompat: () => new Response("error", { status: 500 }),
      keylessCompat: () => new Response("error", { status: 503 }),
      rest: () =>
        new Response(
          JSON.stringify({ items: [restTransaction()], next_page_params: null }),
          { status: 200 },
        ),
    });
    vi.stubGlobal("fetch", mock);

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

    // 5xx is transient: the keyed route is retried 4 times before falling
    // through, the keyless route is tried exactly once, REST succeeds first try.
    expect(countRoute(calls, "keyedCompat")).toBe(4);
    expect(countRoute(calls, "keylessCompat")).toBe(1);
    expect(countRoute(calls, "rest")).toBe(1);

    const restCall = mock.mock.calls.find((call) =>
      String(call[0]).includes("/8453/api/v2/addresses/"),
    );
    const requestUrl = new URL(String(restCall?.[0]));
    expect(requestUrl.pathname).toBe(
      `/8453/api/v2/addresses/${ADDRESS}/transactions`,
    );
    expect(requestUrl.searchParams.get("apikey")).toBe("proapi_test");
  });

  it("falls back to the keyless compatibility endpoint exactly once after a keyed failure", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    setRetrySleepForTesting(async () => {});
    const { mock, calls } = routeFetch({
      keyedCompat: () => new Response("rate limited", { status: 429 }),
      keylessCompat: () => compatEnvelope([compatibilityTransaction()]),
      rest: () => new Response("must not be reached", { status: 500 }),
    });
    vi.stubGlobal("fetch", mock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).resolves.toMatchObject({
      method: "account.txlist",
      transactions: [compatibilityTransaction()],
    });

    expect(countRoute(calls, "keyedCompat")).toBe(4);
    expect(countRoute(calls, "keylessCompat")).toBe(1);
    expect(countRoute(calls, "rest")).toBe(0);

    const keylessCall = mock.mock.calls.find((call) =>
      String(call[0]).startsWith("https://base.blockscout.com/api?"),
    );
    expect(keylessCall).toBeDefined();
    const keylessUrl = new URL(String(keylessCall?.[0]));
    expect(keylessUrl.searchParams.get("apikey")).toBeNull();
    expect(keylessUrl.searchParams.get("action")).toBe("txlist");
  });

  it("treats an empty REST items list as completed empty history", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    setRetrySleepForTesting(async () => {});
    const { mock } = routeFetch({
      keyedCompat: () => new Response("error", { status: 500 }),
      keylessCompat: () => new Response("error", { status: 500 }),
      rest: () =>
        new Response(JSON.stringify({ items: [], next_page_params: null }), {
          status: 200,
        }),
    });
    vi.stubGlobal("fetch", mock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).resolves.toEqual({
      transactions: [],
      method: "REST /addresses/{address}/transactions",
    });
  });

  it("does not retry malformed responses from any transaction route", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    setRetrySleepForTesting(async () => {});
    const { mock, calls } = routeFetch({
      keyedCompat: () =>
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      keylessCompat: () =>
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      rest: () =>
        new Response(JSON.stringify({ items: [{ bad: true }] }), { status: 200 }),
    });
    vi.stubGlobal("fetch", mock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "api-error",
    });
    // A malformed body is a real answer, not a transient failure: one attempt each.
    expect(countRoute(calls, "keyedCompat")).toBe(1);
    expect(countRoute(calls, "keylessCompat")).toBe(1);
    expect(countRoute(calls, "rest")).toBe(1);
  });

  it("reports every route failure without converting them into risk evidence", async () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "proapi_test");
    setRetrySleepForTesting(async () => {});
    const { mock } = routeFetch({
      keyedCompat: () => new Response("error", { status: 500 }),
      keylessCompat: () => new Response("error", { status: 502 }),
      rest: () => new Response("error", { status: 503 }),
    });
    vi.stubGlobal("fetch", mock);

    await expect(getBlockscoutRecentTransactions(ADDRESS)).rejects.toMatchObject({
      name: "ExplorerUnavailableError",
      code: "api-error",
      message: expect.stringContaining(
        "All three Blockscout transaction routes failed",
      ),
    });
    await expect(
      getBlockscoutRecentTransactions(ADDRESS),
    ).rejects.toMatchObject({
      code: "api-error",
      message: expect.stringContaining("keyless-compatibility"),
    });
  });
});
