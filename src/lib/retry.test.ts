import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RETRY_ATTEMPTS,
  RETRY_DELAYS_MS,
  RetryableHttpError,
  fetchWithRetry,
  isRetryableError,
  isRetryableStatus,
  withRetry,
} from "./retry";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records the backoff schedule instead of actually waiting. */
function fakeSleep() {
  const waited: number[] = [];
  return {
    waited,
    sleep: async (ms: number) => {
      waited.push(ms);
    },
  };
}

describe("retry status classification", () => {
  it("retries 429 and 5xx only", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("does not retry ordinary client errors or successes", () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(600)).toBe(false);
  });

  it("treats transport failures as retryable", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("timed out"), { name: "AbortError" }))).toBe(true);
    expect(isRetryableError(new RetryableHttpError(503, "HTTP 503"))).toBe(true);
    expect(isRetryableError(new Error("404 not found"))).toBe(false);
    expect(isRetryableError("plain string")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately when the first attempt succeeds", async () => {
    const task = vi.fn().mockResolvedValue("ok");
    const { waited, sleep } = fakeSleep();

    await expect(withRetry(task, { sleep })).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it("retries a retryable failure using the 600/1800/3200 backoff", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new RetryableHttpError(503, "HTTP 503"))
      .mockRejectedValueOnce(new RetryableHttpError(429, "HTTP 429"))
      .mockResolvedValue("recovered");
    const { waited, sleep } = fakeSleep();

    await expect(withRetry(task, { sleep })).resolves.toBe("recovered");
    expect(task).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([600, 1800]);
  });

  it("fails loudly after exhausting attempts instead of inventing a result", async () => {
    const task = vi.fn().mockRejectedValue(new RetryableHttpError(500, "HTTP 500"));
    const { waited, sleep } = fakeSleep();

    await expect(withRetry(task, { sleep, label: "Blockscout history" })).rejects.toThrow(
      /Blockscout history failed after 4 attempts/,
    );
    expect(task).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
    expect(waited).toEqual([...RETRY_DELAYS_MS]);
  });

  it("stops retrying once the shared deadline has passed", async () => {
    const task = vi.fn().mockRejectedValue(new RetryableHttpError(503, "HTTP 503"));
    const { waited, sleep } = fakeSleep();

    await expect(
      withRetry(task, { sleep, label: "history", deadlineAt: Date.now() - 1 }),
    ).rejects.toThrow(/history failed after 1 attempt \(retry budget exhausted\)/);
    expect(task).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it("does not retry a non-retryable error", async () => {
    const task = vi.fn().mockRejectedValue(new Error("invalid address"));
    const { waited, sleep } = fakeSleep();

    await expect(withRetry(task, { sleep })).rejects.toThrow("invalid address");
    expect(task).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });
});

describe("fetchWithRetry", () => {
  it("returns the first non-transient response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { waited, sleep } = fakeSleep();

    const response = await fetchWithRetry("https://example.test/api", {}, { sleep });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waited).toEqual([600]);
  });

  it("retries a connection failure and surfaces the aggregated failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { waited, sleep } = fakeSleep();

    await expect(
      fetchWithRetry("https://example.test/api", {}, { sleep, label: "provider" }),
    ).rejects.toThrow(/provider failed after 4 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(waited).toEqual([600, 1800, 3200]);
  });

  it("passes a 404 straight through without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { waited, sleep } = fakeSleep();

    const response = await fetchWithRetry("https://example.test/api", {}, { sleep });

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it("applies a fresh per-attempt timeout signal", async () => {
    const seenSignals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
        seenSignals.push(init?.signal);
        return new Response("{}", { status: 200 });
      }),
    );
    const { sleep } = fakeSleep();

    await fetchWithRetry("https://example.test/api", {}, { sleep, timeoutMs: 3500 });

    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
  });
});
