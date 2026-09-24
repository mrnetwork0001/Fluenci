// In-memory limits for the Arcade routes (single VPS process, like /api/chat's).
"use strict";

/**
 * Sliding window: at most `max` hits per `windowMs` for one key. allow() records
 * the hit only when it is allowed. At most `maxKeys` keys are tracked; the least
 * recently seen go first.
 */
function createWindowLimiter({ windowMs, max, maxKeys = 50000 }) {
  const hits = new Map(); // key -> timestamps inside the window, oldest first

  function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.delete(key); // re-insert so Map order tracks recency
    hits.set(key, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  }

  function prune(now = Date.now()) {
    for (const [key, list] of hits) {
      if (!list.length || now - list[list.length - 1] >= windowMs) hits.delete(key);
    }
  }

  const timer = setInterval(() => prune(), 60 * 1000);
  timer.unref?.();
  return { allow, prune, size: () => hits.size };
}

/** At most `max` hits per key per UTC day. */
function createDailyLimiter({ max, maxKeys = 50000 }) {
  let day = "";
  const counts = new Map();

  function allow(key, now = Date.now()) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      counts.clear();
    }
    const n = counts.get(key) || 0;
    if (n >= max) return false;
    counts.delete(key);
    counts.set(key, n + 1);
    while (counts.size > maxKeys) counts.delete(counts.keys().next().value);
    return true;
  }

  return { allow, size: () => counts.size };
}

module.exports = { createWindowLimiter, createDailyLimiter };
