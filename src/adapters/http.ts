/**
 * Shared HTTP with retry, backoff and honest timing.
 *
 * queueMs and serviceMs are kept apart on purpose. If you fold retry and
 * rate-limit waiting into "latency", you end up reporting that a model is slow
 * when in fact your key is throttled — and then you pick a worse model on the
 * strength of your own quota. Provider latency is the last attempt's service
 * time; everything spent waiting for a slot is queue time, reported separately.
 */

export type HttpResult = { json: any; queueMs: number; serviceMs: number; retries: number };

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; maxRetries?: number; jitter?: () => number } = {},
): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxRetries = opts.maxRetries ?? 4;
  const jitter = opts.jitter ?? Math.random;

  const t0 = Date.now();
  let retries = 0, lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const serviceMs = Date.now() - started;
      const text = await res.text();

      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
          retries++;
          // Honour Retry-After when the provider sends it; guessing is how you
          // get your key rate-limited harder.
          const ra = Number(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(ra) && ra > 0
            ? ra * 1000
            : Math.min(30_000, 2 ** attempt * 1000) * (0.5 + jitter());
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      }

      return {
        json: JSON.parse(text),
        queueMs: Date.now() - t0 - serviceMs,
        serviceMs,
        retries,
      };
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      const http4xx = err instanceof Error && /^HTTP 4/.test(err.message) && !/^HTTP (408|409|429)/.test(err.message);
      // A malformed request will be malformed the second time too. Retrying a
      // 400 just spends money confirming it.
      if (http4xx || attempt >= maxRetries) break;
      if (aborted) retries++;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2 ** attempt * 1000) * (0.5 + jitter())));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
