"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");
const { createLeaderboard, isoWeek, KEEP_WEEKS } = require("../arcade/leaderboard");

const quiet = { error() {} };
const dirs = [];
const tmpFile = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-board-"));
  dirs.push(dir);
  return path.join(dir, "data", "arcade.json");
};
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const wallets = Array.from({ length: 30 }, () => ethers.Wallet.createRandom().address);
const THU = Date.UTC(2026, 8, 24, 12); // Thursday 24 Sep 2026, ISO week 39
const WEEK = 7 * 86400000;

test("isoWeek: ISO 8601 weeks in UTC, including year edges", () => {
  assert.equal(isoWeek(THU), "2026-W39");
  assert.equal(isoWeek(Date.UTC(2026, 8, 21, 0, 0, 0)), "2026-W39", "Monday 00:00 UTC starts the week");
  assert.equal(isoWeek(Date.UTC(2026, 8, 20, 23, 59, 59)), "2026-W38", "Sunday night is the previous week");
  assert.equal(isoWeek(Date.UTC(2021, 0, 3)), "2020-W53", "early January can belong to the previous year");
  assert.equal(isoWeek(Date.UTC(2024, 11, 30)), "2025-W01", "late December can belong to the next year");
  assert.equal(isoWeek(Date.UTC(2026, 0, 1)), "2026-W01");
  assert.equal(isoWeek(Date.UTC(2027, 0, 1)), "2026-W53");
});

test("ordering: best score first, ties to whoever got there first, top 20 only", () => {
  const clock = { t: THU };
  const board = createLeaderboard({ file: tmpFile(), now: () => clock.t, log: quiet });
  wallets.forEach((w, i) => { clock.t += 1000; board.submit(w, (i % 10) * 10 + 10); });
  const v = board.view();
  assert.equal(v.week, "2026-W39");
  assert.equal(v.entries.length, 20);
  const scores = v.entries.map((e) => e.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "descending");
  // wallets 9, 19, 29 all scored 100: earliest first.
  assert.deepEqual(v.entries.slice(0, 3).map((e) => e.address), [wallets[9], wallets[19], wallets[29]]);
  assert.deepEqual(Object.keys(v.entries[0]).sort(), ["address", "score"], "only address and score are published");
  assert.equal(v.you, null);
  // A wallet outside the top 20 still gets its rank.
  const last = board.view(wallets[0]);
  assert.deepEqual(last.you, { best: 10, rank: 28 }, "wallet 0 scored 10, after 27 others (3 of them tied at 10 but later)");
});

test("one best per wallet per week: a lower score never replaces it", () => {
  const clock = { t: THU };
  const board = createLeaderboard({ file: tmpFile(), now: () => clock.t, log: quiet });
  assert.deepEqual(board.submit(wallets[0], 50), { best: 50, rank: 1, week: "2026-W39" });
  assert.deepEqual(board.submit(wallets[1], 70), { best: 70, rank: 1, week: "2026-W39" });
  assert.deepEqual(board.submit(wallets[0], 30), { best: 50, rank: 2, week: "2026-W39" });
  assert.deepEqual(board.submit(wallets[0], 90), { best: 90, rank: 1, week: "2026-W39" });
  assert.deepEqual(board.submit(wallets[0].toLowerCase(), 80), { best: 90, rank: 1, week: "2026-W39" }, "any letter case");
  assert.equal(board.view().entries.length, 2);
  assert.deepEqual(board.submit(wallets[2], 0), { best: 0, rank: null, week: "2026-W39" }, "a zero score isn't listed");
  assert.equal(board.view().entries.length, 2);
});

test("week rollover: a new ISO week starts empty; only the last 8 weeks are kept", () => {
  const file = tmpFile();
  const clock = { t: THU };
  const board = createLeaderboard({ file, now: () => clock.t, log: quiet });
  board.submit(wallets[0], 40);
  clock.t = Date.UTC(2026, 8, 27, 23, 59, 59); // Sunday night, same week
  assert.equal(board.view().entries.length, 1);
  clock.t = Date.UTC(2026, 8, 28, 0, 0, 0); // Monday 00:00 UTC
  const next = board.view(wallets[0]);
  assert.deepEqual(next, { week: "2026-W40", entries: [], you: null });
  assert.deepEqual(board.submit(wallets[0], 20), { best: 20, rank: 1, week: "2026-W40" }, "a fresh best in the new week");

  for (let i = 0; i < 10; i++) { clock.t += WEEK; board.submit(wallets[1], 10 + i); }
  assert.equal(board.weeks().length, KEEP_WEEKS);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(Object.keys(saved.weeks).length, KEEP_WEEKS);
  assert.ok(!saved.weeks["2026-W39"] && !saved.weeks["2026-W40"], "the oldest weeks are gone");
});

test("persistence: atomic writes, reloaded by a new process, bad file kept aside", () => {
  const file = tmpFile();
  const clock = { t: THU };
  const a = createLeaderboard({ file, now: () => clock.t, log: quiet });
  a.submit(wallets[0], 30);
  a.submit(wallets[1], 60);
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(`${file}.tmp`), "no temp file left behind");
  const b = createLeaderboard({ file, now: () => clock.t, log: quiet });
  assert.deepEqual(b.view(wallets[0]), {
    week: "2026-W39",
    entries: [{ address: wallets[1], score: 60 }, { address: wallets[0], score: 30 }],
    you: { best: 30, rank: 2 },
  });

  fs.writeFileSync(file, "{ not json");
  const errors = [];
  const c = createLeaderboard({ file, now: () => clock.t, log: { error: (m) => errors.push(m) } });
  assert.deepEqual(c.view().entries, []);
  assert.equal(errors.length, 1);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.startsWith("arcade.json.bad-")), "unreadable file renamed, not overwritten");

  // Rows that aren't valid are dropped on load.
  fs.writeFileSync(file, JSON.stringify({ weeks: { "2026-W39": {
    a: { address: "0xnope", score: 10 }, b: { address: wallets[2], score: -5 }, c: { address: wallets[3], score: 40, at: 1 },
  }, "bogus": {} } }));
  const d = createLeaderboard({ file, now: () => clock.t, log: quiet });
  assert.deepEqual(d.view().entries, [{ address: wallets[3], score: 40 }]);
});
