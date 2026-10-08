export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * fetch with per-attempt timeout and backoff. Retries 429/5xx:
 * honors Retry-After (capped at 30s) on 429, otherwise exponential backoff.
 * A stalled connection can never hang the caller longer than the timeout.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  tries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    let waitMs: number | undefined;
    try {
      const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
      if (init.signal) signals.push(init.signal);
      const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        waitMs =
          res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 30) * 1000
            : 1000 * 2 ** i;
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i >= tries - 1) break;
      await sleep(waitMs ?? 1000 * 2 ** i);
    }
  }
  throw lastErr;
}
