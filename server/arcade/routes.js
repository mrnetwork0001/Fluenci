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
  bad_ticket: "The server has no usable ticket for this game (already used, expired, not yours, or the server restarted). Start a new game.",
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
    startIp: { windowMs: 10 * 60 * 1000, max: 60 },
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

  // A1: a one-time EIP-4361 message for the wallet to sign. Pending nonces are
  // kept per (wallet, requester IP); a new request only displaces that same
  // IP's own oldest attempt, never a pending sign-in from another IP.
  app.post("/auth/nonce", requireConfigured, perIp("nonce"), json(), (req, res) => {
    const address = req.body?.address;
    if (!validAddress(address)) return fail(res, 400, "bad_request", "A valid wallet address is required.");
    const issued = auth.issueNonce(address, clientIp(req));
    if (issued.code === "busy") {
      return fail(res, 503, "busy", "Too many sign-ins are in progress right now. Try again in a few minutes.");
    }
    res.json({ message: issued.message, nonce: issued.nonce, expiresAt: issued.expiresAt });
  });

  // A2: the nonce (or the exact message) the client was given plus its
  // signature in, a session token out. The nonce is looked up directly, so
  // nonce requests from anyone else for this wallet can't displace it.
  const VERIFY_ERRORS = {
    bad_request: [400, "A wallet address, this sign-in's nonce or message, and a signature are required."],
    bad_message: [400, "That isn't the sign-in message this server issued. Sign in again."],
    expired_nonce: [401, "The server no longer has this sign-in request (it expired, was already used, or the server restarted). Sign in again."],
    bad_signature: [401, "The signature doesn't match this wallet. Sign in again."],
  };
  const optionalText = (v, max) => v === undefined || (typeof v === "string" && v.length > 0 && v.length <= max);
  app.post("/auth/verify", requireConfigured, perIp("verify"), json(), (req, res) => {
    const { address, signature, nonce, message } = req.body || {};
    if (!validAddress(address) || typeof signature !== "string" || (nonce === undefined && message === undefined) ||
        !optionalText(nonce, 128) || !optionalText(message, 2000)) {
      return fail(res, 400, "bad_request", VERIFY_ERRORS.bad_request[1]);
    }
    const result = auth.verify({ address, signature, nonce, message });
    if (!result.ok) {
      const code = VERIFY_ERRORS[result.code] ? result.code : "bad_signature";
      return fail(res, VERIFY_ERRORS[code][0], code, VERIFY_ERRORS[code][1]);
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

  // A6: a single-use ticket and the seed the game must be played with. Both
  // limits run before the pass check, so repeated starts - from a wallet
  // without a pass too - stop before they reach the chain.
  const perWalletStart = (req, res, next) => (limiter.start.allow(req.session.address.toLowerCase())
    ? next()
    : fail(res, 429, "rate_address", "You've started a lot of games in the last hour. Take a short break and try again."));
  app.post("/arcade/snake/start", perIp("startIp"), requireSession, perWalletStart, requirePass, (req, res) => {
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

  // A8: this week's top 20, public. With a valid token, the caller's own
  // standing too. A token that is sent but can't be accepted gets 401, so the
  // app drops it instead of showing a stale "you".
  app.get("/arcade/leaderboard", perIp("board"), optionalSession, (req, res) => {
    res.json(leaderboard.view(req.session ? req.session.address : null));
  });

  return { requireSession, requirePass };
}

module.exports = { mountArcade, FINISH_BODY_LIMIT };
