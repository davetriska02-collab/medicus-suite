// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — per-key sliding-window rate limiter (in-memory). Admission control so one clinician (or
// a runaway client) cannot swamp the single local GPU. `now` is injectable for tests.

export function createRateLimiter({ rpm = 60, now = () => Date.now() } = {}) {
  const windowMs = 60_000;
  const hits = new Map(); // key -> ascending timestamps within the window

  function check(key) {
    if (!rpm || rpm <= 0) return { ok: true }; // 0/disabled
    const t = now();
    const arr = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
    if (arr.length >= rpm) {
      hits.set(key, arr);
      const retryAfter = Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000));
      return { ok: false, retryAfter };
    }
    arr.push(t);
    hits.set(key, arr);
    return { ok: true };
  }

  return { check };
}
