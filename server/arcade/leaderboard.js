// Weekly Snake leaderboard: each wallet's best replay-checked score per ISO week
// (UTC). Kept in server/data/arcade.json, written atomically; only the last
// `keepWeeks` weeks are kept. Bragging rights only - there are no prizes.
"use strict";
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const KEEP_WEEKS = 8;
const TOP = 20;

/** ISO 8601 week of a moment, in UTC: "YYYY-Www". */
function isoWeek(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  // The Thursday of this week decides the year and the week number.
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / 86400000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Higher score first; on a tie, whoever got there first; then by address so the
// order never depends on insertion.
const byRank = (a, b) => b.score - a.score || a.at - b.at || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);

function createLeaderboard({ file, now = Date.now, keepWeeks = KEEP_WEEKS, top = TOP, log = console } = {}) {
  let weeks = load();
  const sorted = new Map(); // week -> ranked rows, rebuilt after a change

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const out = {};
      for (const [week, rows] of Object.entries(raw?.weeks || {})) {
        if (!/^\d{4}-W\d{2}$/.test(week) || !rows || typeof rows !== "object") continue;
        out[week] = {};
        for (const row of Object.values(rows)) {
          if (!row || !ethers.isAddress(row.address) || !Number.isSafeInteger(row.score) || row.score <= 0) continue;
          const address = ethers.getAddress(row.address);
          out[week][address.toLowerCase()] = { address, score: row.score, at: Number(row.at) || 0 };
        }
      }
      return out;
    } catch (err) {
      if (err.code !== "ENOENT") {
        log.error(`[ARCADE] Could not read ${file}: ${err.message}`);
        // Keep the unreadable file for inspection instead of overwriting it.
        try { fs.renameSync(file, `${file}.bad-${Date.now()}`); } catch { /* ignore */ }
      }
      return {};
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, weeks }, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      log.error(`[ARCADE] Could not save ${file}: ${err.message}`);
    }
  }

  function prune() {
    const keys = Object.keys(weeks).sort();
    for (const week of keys.slice(0, Math.max(0, keys.length - keepWeeks))) {
      delete weeks[week];
      sorted.delete(week);
    }
  }

  function ranked(week) {
    if (!sorted.has(week)) sorted.set(week, Object.values(weeks[week] || {}).sort(byRank));
    return sorted.get(week);
  }

  function standing(week, address) {
    if (!address) return null;
    const key = String(address).toLowerCase();
    const rows = ranked(week);
    const i = rows.findIndex((r) => r.address.toLowerCase() === key);
    return i === -1 ? null : { best: rows[i].score, rank: i + 1 };
  }

  /** Records a checked score for `address` this week. -> { best, rank, week } */
  function submit(address, score) {
    const t = now();
    const week = isoWeek(t);
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();
    if (Number.isSafeInteger(score) && score > 0) {
      const rows = weeks[week] || (weeks[week] = {});
      if (!rows[key] || score > rows[key].score) {
        rows[key] = { address: wallet, score, at: t };
        sorted.delete(week);
        prune();
        save();
      }
    }
    const you = standing(week, wallet);
    return { best: you ? you.best : 0, rank: you ? you.rank : null, week };
  }

  /** This week's top `top`, plus `address`'s own standing when given. */
  function view(address = null) {
    const week = isoWeek(now());
    const entries = ranked(week).slice(0, top).map((r) => ({ address: r.address, score: r.score }));
    return { week, entries, you: standing(week, address) };
  }

  prune();
  return { submit, view, weeks: () => Object.keys(weeks).sort() };
}

module.exports = { KEEP_WEEKS, TOP, isoWeek, createLeaderboard };
