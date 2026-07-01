// Fetch with a per-call timeout + exponential backoff. Built for the DeepDossier
// module because Apollo and Hunter both throttle (HTTP 429) and can blip 5xx.
// The rest of the app uses a plain AbortController + graceful fallback (no retry);
// this adds retries ONLY where a rate-limited third party makes them worth it.
//
// Behaviour:
//   - aborts each attempt after `timeoutMs` (default 12s)
//   - retries on network error, 429, and 5xx (up to `retries` extra attempts)
//   - does NOT retry on 4xx other than 429 (a bad request won't fix itself)
//   - backoff = base * 2^attempt with a little jitter, capped; honours Retry-After
//   - never throws for a "handled" HTTP status: returns the Response so the caller
//     can read the body. Throws only if every attempt errored/timed out.

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchRetry(url, opts, cfg) {
  opts = opts || {};
  cfg = cfg || {};
  const retries = cfg.retries != null ? cfg.retries : 3;      // extra attempts after the first
  const timeoutMs = cfg.timeoutMs != null ? cfg.timeoutMs : 12000;
  const baseMs = cfg.baseMs != null ? cfg.baseMs : 500;       // first backoff
  const capMs = cfg.capMs != null ? cfg.capMs : 8000;         // max single backoff
  const retryOn = cfg.retryOn || ((status) => status === 429 || (status >= 500 && status <= 599));

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      clearTimeout(t);
      if (attempt < retries && retryOn(res.status)) {
        // Prefer the server's Retry-After (seconds) when present.
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const wait = ra > 0 ? Math.min(ra * 1000, capMs)
          : Math.min(baseMs * Math.pow(2, attempt), capMs) + Math.floor(Math.random() * 250);
        await sleep(wait);
        continue;
      }
      return res; // success, or a non-retryable status (caller inspects res.ok / res.status)
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) {
        await sleep(Math.min(baseMs * Math.pow(2, attempt), capMs) + Math.floor(Math.random() * 250));
        continue;
      }
    }
  }
  throw lastErr || new Error('fetchRetry: request failed');
}

module.exports = { fetchRetry };
