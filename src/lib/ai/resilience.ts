/**
 * resilience.ts — exponential backoff + retry for AI provider calls.
 *
 * Retries on:
 *   - HTTP 429 (rate limit) — with Retry-After header respect if present
 *   - HTTP 5xx (server errors)
 *   - Network errors (fetch failed, AbortError)
 *
 * Does NOT retry on:
 *   - HTTP 4xx (bad request, invalid key, etc.) — these are caller bugs
 *   - Tool call errors — those are logic errors, not transient
 */

export interface RetryOptions {
  maxAttempts?: number;       // default 3
  baseDelayMs?: number;       // default 1000ms
  maxDelayMs?: number;        // default 16_000ms
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export class TimeoutError extends Error {
  timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

const DEFAULT_OPTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 16_000,
  onRetry: () => {},
};

function isPermanentQuotaErrorMessage(msg: string): boolean {
  return (
    (msg.includes("quota exceeded") || msg.includes("resource_exhausted")) &&
    (msg.includes("limit: 0") || msg.includes("perday") || msg.includes("billing"))
  );
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (isPermanentQuotaErrorMessage(msg)) return false;
    // Network failures
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("econnrefused")) return true;
    // Rate limit / server error codes embedded in message
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many")) return true;
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    // Anthropic SDK specific
    if (msg.includes("overloaded")) return true;
  }
  // Check if it's an API error object with a status field
  if (typeof err === "object" && err !== null) {
    const status = (err as Record<string, unknown>).status as number | undefined;
    if (status === 429 || (status !== undefined && status >= 500)) return true;
  }
  return false;
}

function extractRetryAfterMs(err: unknown): number | null {
  // Some SDKs expose headers on the error
  if (typeof err === "object" && err !== null) {
    const headers = (err as Record<string, unknown>).headers as Record<string, string> | undefined;
    if (headers?.["retry-after"]) {
      const secs = parseFloat(headers["retry-after"]);
      if (!isNaN(secs)) return secs * 1_000;
    }
  }
  if (err instanceof Error) {
    const message = err.message;
    const secondsMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
    if (secondsMatch) {
      const secs = parseFloat(secondsMatch[1]);
      if (!Number.isNaN(secs)) return secs * 1_000;
    }
    const delayMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (delayMatch) {
      const secs = parseFloat(delayMatch[1]);
      if (!Number.isNaN(secs)) return secs * 1_000;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "Operation",
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Wraps a single tool dispatch with an 8-second hard timeout.
 * Throws TimeoutError if the tool does not resolve in time.
 */
export function withToolTimeout<T>(
  promise: Promise<T>,
  toolName: string,
  timeoutMs = 8_000,
): Promise<T> {
  return withTimeout(promise, timeoutMs, `Tool "${toolName}"`);
}

/**
 * Wraps an async function with exponential backoff retry.
 *
 * @param fn      The async function to execute (called with no args)
 * @param opts    Retry configuration
 * @returns       The result of `fn` on the first successful attempt
 * @throws        The last error if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, onRetry } = {
    ...DEFAULT_OPTS,
    ...opts,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }

      // Respect Retry-After if present, otherwise exponential backoff
      const retryAfterMs = extractRetryAfterMs(err);
      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const waitMs = retryAfterMs ?? backoff;

      onRetry(attempt, waitMs, err);
      await delay(waitMs);
    }
  }

  throw lastError;
}
