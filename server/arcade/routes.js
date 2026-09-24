// Arcade routes: wallet sign-in, the server-side pass check, Snake tickets and
// score checks, and the weekly leaderboard. Every error body is {error, code}
// (Snake finish rejections also carry accepted:false), so the client can word
// each case. CORS for these paths is set in server.js (Fluenci's own origins).
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const { sessionMiddleware, NOT_CONFIGURED } = require("../auth");
const { createWindowLimiter } = require("./rateLimit");

const FINISH_BODY_LIMIT = "512kb"; // a 30-minute game's turn log fits with room to spare
const ARCADE_NOT_CONFIGURED = "The Arcade isn't set up on the server yet.";
const NO_PASS = "An active Fluenci Arcade Pass is needed for this.";
const PASS_UNAVAILABLE = "Couldn't check your Arcade Pass right now. Try again in a minute.";
const RATE_IP = "Too many requests from your network. Wait a few minutes and try again.";

const FINISH_ERRORS = {
  bad_ticket: "This game's ticket isn't valid (already used, or not yours). Start a new game.",
  mismatch: "This score doesn't match the game that was played, so it wasn't recorded.",
  too_fast: "This game finished faster than it can be played, so the score wasn't recorded.",
  too_long: "This game is longer than a scored game can be (30 minutes), so the score wasn't recorded.",
  bad_request: "Invalid request body.",
};

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ ...extra, error, code });

/**
 * Mounts the Arcade routes on `app` and returns the middleware /api/chat
 * reuses: requireSession (a signed-in wallet) and requirePass (that wallet holds
 * a valid Arcade Pass, checked on chain).
 */
function mountArcade(app, {
  auth,
  passChecker,
  snake,
  leaderboard,
  clientIp = (req) => req.socket?.remoteAddress || "unknown",
  limits = {},
} = {}) {
  const L = {
    nonce: { windowMs: 10 * 60 * 1000, max: 30 },
    verify: { windowMs: 10 * 60 * 1000, max: 30 },
    pass: { windowMs: 10 * 60 * 1000, max: 120 },
    start: { windowMs: 60 * 60 * 1000, max: 60 },     // per wallet
    finish: { windowMs: 10 * 60 * 1000, max: 120 },
    board: { windowMs: 10 * 60 * 1000, max: 240 },
    ...limits,
  };
  const limiter = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, createWindowLimiter(v)]));

  const requireSession = sessionMiddleware(auth);
  const optionalSession = sessionMiddleware(auth, { optional: true });
  const requireConfigured = (req, res, next) =>
    auth.configured ? next() : fail(res, 503, "not_configured", NOT_CONFIGURED);
  const perIp = (name, extra) => (req, res, next) =>
    limiter[name].allow(clientIp(req)) ? next() : fail(res, 429, "rate_ip", RATE_IP, extra);
  // Route-scoped JSON parsing, so the routes behave the same with or without an
  // app-wide parser (express.json skips a body that is already parsed).
  const json = (limit = "16kb", extra = {}) => {
    const parse = express.json({ limit });
    return (req, res, next) => parse(req, res, (err) => {
      if (!err) return next();
      if (err.type === "entity.too.large") {
        return extra.accepted === false
          ? fail(res, 400, "too_long", FINISH_ERRORS.too_long, extra)
          : fail(res, 413, "too_large", "Request body too large.", extra);
      }
      return fail(res, 400, "bad_request", "Invalid request body.", extra);
    });
  };

  async function requirePass(req, res, next) {
    let result;
    try {
      result = await passChecker.check(req.session.address);
    } catch {
      result = { valid: false, reason: "unavailable" };
    }
    if (result.valid) {
      req.pass = result;
      return next();
    }
    if (result.reason === "not-configured") return fail(res, 503, "not_configured", ARCADE_NOT_CONFIGURED);
    return fail(res, 403, "no_pass", result.reason === "unavailable" ? PASS_UNAVAILABLE : NO_PASS, { reason: result.reason });
  }

  const validAddress = (a) => typeof a === "string" && ethers.isAddress(a);

  // A1: a one-time message for the wallet to sign.
  app.post("/auth/nonce", requireConfigured, perIp("nonce"), json(), (req, res) => {
    const address = req.body?.address;
    if (!validAddress(address)) return fail(res, 400, "bad_request", "A valid wallet address is required.");
    res.json(auth.issueNonce(address));
  });

  // A2: signature in, session token out.
  app.post("/auth/verify", requireConfigured, perIp("verify"), json(), (req, res) => {
    const { address, signature } = req.body || {};
    if (!validAddress(address) || typeof signature !== "string") {
      return fail(res, 400, "bad_request", "A wallet address and signature are required.");
    }
    const result = auth.verify(address, signature);
    if (!result.ok) {
      return result.code === "expired_nonce"
        ? fail(res, 401, "expired_nonce", "This sign-in request has expired or was already used. Sign in again.")
        : fail(res, 401, "bad_signature", "The signature doesn't match this wallet. Sign in again.");
    }
    res.json({ token: result.token, address: result.address, expiresAt: result.expiresAt });
  });

  // A4: the signed-in wallet's pass, checked on chain.
  app.get("/arcade/pass", perIp("pass"), requireSession, async (req, res) => {
    let result;
    try {
      result = await passChecker.check(req.session.address);
    } catch {
      result = { valid: false, reason: "unavailable" };
    }
    res.json({ valid: Boolean(result.valid), reason: result.reason });
  });

  // A6: a single-use ticket and the seed the game must be played with.
  app.post("/arcade/snake/start", requireSession, requirePass, (req, res) => {
    if (!limiter.start.allow(req.session.address.toLowerCase())) {
      return fail(res, 429, "rate_address", "You've started a lot of games in the last hour. Take a short break and try again.");
    }
    res.json(snake.start(req.session.address));
  });

  // A7: replayed from the seed; only a score the replay reaches is recorded.
  const rejected = { accepted: false };
  app.post("/arcade/snake/finish", perIp("finish", rejected), requireSession, json(FINISH_BODY_LIMIT, rejected), (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = snake.finish(req.session.address, { ticket: body.ticket, inputs: body.inputs, score: body.score });
    if (!result.accepted) return fail(res, 400, result.code, FINISH_ERRORS[result.code] || FINISH_ERRORS.mismatch, rejected);
    const standing = leaderboard.submit(req.session.address, result.score);
    res.json({ accepted: true, score: result.score, best: standing.best, rank: standing.rank, week: standing.week });
  });

  // A8: this week's top 20; with a valid token, the caller's own standing too.
  app.get("/arcade/leaderboard", perIp("board"), optionalSession, (req, res) => {
    res.json(leaderboard.view(req.session ? req.session.address : null));
  });

  return { requireSession, requirePass };
}

module.exports = { mountArcade, FINISH_BODY_LIMIT };
