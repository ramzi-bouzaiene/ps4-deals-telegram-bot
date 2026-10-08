export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  tries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1000 * 2 ** i);
    }
  }
  throw lastErr;
}
