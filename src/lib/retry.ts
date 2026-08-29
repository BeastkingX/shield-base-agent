/**
 * Shield retry policy for outbound provider calls.
 *
 * Retries only transient conditions: HTTP 429, HTTP 5xx, and connection
 * failures (DNS, refused socket, timeout). A 4xx other than 429 is a real
 * answer from the provider and must never be retried into existence.
 *
 * Retrying never fabricates data: a call that exhausts its attempts throws,
 * and callers are responsible for reporting the evidence as unavailable.
 */

/** Backoff applied before retry 1, 2 and 3. */
export const RETRY_DELAYS_MS: readonly number[] = [600, 1800, 3200];

/** Total attempts = 1 initial call + RETRY_DELAYS_MS.length retries. */
export const RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export interface RetryOptions {
  /** Total attempts including the first one. Defaults to RETRY_ATTEMPTS (4). */
  attempts?: number;
  /** Delay before each retry. Defaults to RETRY_DELAYS_MS. */
  delays?: readonly number[];
  /** Label used in the final aggregated error message. */
  label?: string;
  /** Per-attempt timeout in milliseconds. Omit to use the caller's signal. */
  timeoutMs?: number;
  /** Injectable wait, used by tests to avoid real backoff delays. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Epoch milliseconds after which no further retry is started. Lets several
   * sequential provider routes share one budget so the retry policy cannot
   * outlast the serverless `maxDuration` of the calling route.
   */
  deadlineAt?: number;
}

/** Thrown when a provider answers with a status worth retrying. */
export class RetryableHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RetryableHttpError";
    this.status = status;
  }
}

/** True for 429 (rate limited) and any 5xx (provider-side failure). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * True for transport-level failures: the request never produced an HTTP
 * answer. Includes fetch network errors and abort/timeout signals.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  if (!(error instanceof Error)) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") return true;

  return /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|terminated/i.test(
    error.message,
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Test seam: lets unit tests observe the backoff schedule without waiting for
 * it. Production code never sets this.
 */
let sleepOverride: ((ms: number) => Promise<void>) | null = null;

export function setRetrySleepForTesting(
  override: ((ms: number) => Promise<void>) | null,
): void {
  sleepOverride = override;
}

function currentSleep(): (ms: number) => Promise<void> {
  return sleepOverride ?? defaultSleep;
}

/**
 * Runs `task` until it succeeds or the attempts are exhausted.
 * Non-retryable errors are rethrown immediately.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = RETRY_ATTEMPTS,
    delays = RETRY_DELAYS_MS,
    label = "request",
    sleep = currentSleep(),
    deadlineAt,
  } = options;

  const failures: string[] = [];
  let attemptsMade = 0;
  let budgetExhausted = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      return await task(attempt);
    } catch (error) {
      if (!isRetryableError(error)) throw error;

      const detail = error instanceof Error ? error.message : "request failed";
      failures.push(`attempt ${attempt}: ${detail}`);

      if (attempt >= attempts) break;

      // Shared budget exhausted: stop retrying rather than overrunning the
      // caller's serverless timeout. The failure is still reported honestly.
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        budgetExhausted = true;
        break;
      }

      const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
      await sleep(delay);
    }
  }

  throw new Error(
    `${label} failed after ${attemptsMade} attempt${attemptsMade === 1 ? "" : "s"}${
      budgetExhausted ? " (retry budget exhausted)" : ""
    }. ${failures.join(" | ")}`,
  );
}

/**
 * `fetch` with the Shield retry policy. Retries 429/5xx/connection failures
 * and returns the first response that is not transiently failing.
 *
 * A non-2xx response that is not retryable is returned to the caller, exactly
 * as plain fetch would, so error wording stays truthful.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const { timeoutMs, ...retryOptions } = options;

  return withRetry(async () => {
    let response: Response;
    try {
      response = await fetch(input, {
        ...init,
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (error) {
      // Transport failure: normalise so withRetry recognises it as retryable.
      if (isRetryableError(error)) {
        throw new RetryableHttpError(
          0,
          error instanceof Error ? error.message : "connection failed",
        );
      }
      throw error;
    }

    if (isRetryableStatus(response.status)) {
      throw new RetryableHttpError(
        response.status,
        `HTTP ${response.status}`,
      );
    }

    return response;
  }, {
    ...retryOptions,
    label: retryOptions.label ?? String(input),
  });
}
