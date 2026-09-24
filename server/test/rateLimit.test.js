"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindowLimiter, createDailyLimiter } = require("../arcade/rateLimit");

test("window limiter: max hits per window per key, sliding", () => {
  const l = createWindowLimiter({ windowMs: 1000, max: 3 });
  const t = 1_000_000;
  assert.deepEqual([l.allow("a", t), l.allow("a", t + 1), l.allow("a", t + 2), l.allow("a", t + 3)], [true, true, true, false]);
  assert.equal(l.allow("b", t + 3), true, "keys are independent");
  assert.equal(l.allow("a", t + 999), false, "still inside the window");
  assert.equal(l.allow("a", t + 1000), true, "the oldest hit slid out");
  l.prune(t + 5000);
  assert.equal(l.size(), 0);
});

test("window limiter: tracked keys are capped, least recent first", () => {
  const l = createWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
  l.allow("a", 1);
  l.allow("b", 2);
  l.allow("c", 3);
  assert.equal(l.size(), 2);
  assert.equal(l.allow("a", 4), true, "a was evicted, so it starts fresh");
});

test("daily limiter: max per key per UTC day, reset at midnight UTC", () => {
  const l = createDailyLimiter({ max: 2 });
  const day = Date.UTC(2026, 8, 24, 23, 59, 0);
  assert.deepEqual([l.allow("w", day), l.allow("w", day + 1), l.allow("w", day + 2)], [true, true, false]);
  assert.equal(l.allow("x", day), true);
  assert.equal(l.allow("w", Date.UTC(2026, 8, 25, 0, 0, 0)), true, "new UTC day");
});
