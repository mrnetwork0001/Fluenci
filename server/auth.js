// Wallet sign-in for the Fluenci Arcade.
//
// POST /auth/nonce hands out a one-time message; the wallet signs it with
// personal_sign (EIP-191); POST /auth/verify checks the signature and returns a
// session token that the Arcade routes take as "Authorization: Bearer <token>".
// Signing costs nothing and sends no transaction. Only plain wallets (EOAs) can
// sign in: a contract wallet's signature can't be checked with ecrecover.
//
// Token: base64url(JSON {v:1, addr, iat, exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET, first part)).
// No server-side session store: a token is valid until it expires (12 hours),
// and rotating SESSION_SECRET signs everyone out.
"use strict";
const crypto = require("crypto");
const { ethers } = require("ethers");

const SIGN_IN_DOMAIN = "fluenci.xyz";
const SIGN_IN_CHAIN_ID = 1990;
const MIN_SECRET_LENGTH = 32;
const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TOKEN_CHARS = 1024;
const MAX_SIGNATURE_CHARS = 200;

/** The exact text a wallet signs to sign in. */
function signInMessage({ address, nonce, issuedAt, expiresAt }) {
  return `${SIGN_IN_DOMAIN} wants you to sign in with your wallet:\n${address}\n\n` +
    "Sign in to the Fluenci Arcade. This does not send a transaction or cost gas.\n\n" +
    `Chain ID: ${SIGN_IN_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`;
}

/** A SESSION_SECRET is usable when it is at least 32 characters. */
const secretUsable = (secret) => typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;

/**
 * Everything auth-related for one SESSION_SECRET. With no usable secret,
 * `configured` is false and nothing can be issued or verified.
 * Nonces live in memory: at most `maxPerAddress` per wallet (the oldest goes
 * first) and `maxNonces` in total.
 */
function createAuth({
  secret = "",
  now = Date.now,
  nonceTtlMs = NONCE_TTL_MS,
  tokenTtlMs = TOKEN_TTL_MS,
  maxNonces = 20000,
  maxPerAddress = 5,
} = {}) {
  const configured = secretUsable(secret);
  const nonces = new Map();     // nonce -> { key, message, expiresAt }
  const byAddress = new Map();  // lowercase address -> [nonce, ...], oldest first

  const hmac = (payload) => crypto.createHmac("sha256", secret).update(payload).digest();

  function forget(nonce, key = nonces.get(nonce)?.key) {
    nonces.delete(nonce);
    if (!key) return;
    const list = (byAddress.get(key) || []).filter((n) => n !== nonce);
    if (list.length) byAddress.set(key, list);
    else byAddress.delete(key);
  }

  function prune() {
    const t = now();
    for (const [nonce, entry] of nonces) if (entry.expiresAt <= t) forget(nonce);
  }

  /** A fresh sign-in message for `address` (any valid address). */
  function issueNonce(address) {
    if (!configured) throw new Error("SESSION_SECRET not configured");
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();
    const nonce = crypto.randomBytes(16).toString("hex"); // 128 bits
    const issued = now();
    const issuedAt = new Date(issued).toISOString();
    const expiresAt = new Date(issued + nonceTtlMs).toISOString();
    const message = signInMessage({ address: wallet, nonce, issuedAt, expiresAt });

    let list = byAddress.get(key) || [];
    while (list.length >= maxPerAddress) {
      forget(list[0], key);
      list = byAddress.get(key) || [];
    }
    nonces.set(nonce, { key, message, expiresAt: issued + nonceTtlMs });
    byAddress.set(key, [...list, nonce]);
    while (nonces.size > maxNonces) forget(nonces.keys().next().value);
    return { message, nonce, expiresAt };
  }

  function issueToken(address) {
    const iat = Math.floor(now() / 1000);
    const exp = iat + Math.floor(tokenTtlMs / 1000);
    const payload = Buffer.from(JSON.stringify({ v: 1, addr: address, iat, exp })).toString("base64url");
    const token = `${payload}.${hmac(payload).toString("base64url")}`;
    return { token, address, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /**
   * Checks `signature` against the live sign-in messages issued for `address`.
   * -> { ok: true, token, address, expiresAt } | { ok: false, code: "expired_nonce" | "bad_signature" }
   * A matching nonce is used up; a failed attempt leaves it for a retry.
   */
  function verify(address, signature) {
    if (!configured) throw new Error("SESSION_SECRET not configured");
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();
    const t = now();
    const live = (byAddress.get(key) || []).map((n) => [n, nonces.get(n)]).filter(([, e]) => e && e.expiresAt > t);
    if (!live.length) return { ok: false, code: "expired_nonce" };
    if (typeof signature !== "string" || signature.length > MAX_SIGNATURE_CHARS) return { ok: false, code: "bad_signature" };
    for (const [nonce, entry] of live.reverse()) {
      let signer = null;
      try { signer = ethers.verifyMessage(entry.message, signature); } catch { signer = null; }
      if (signer && signer.toLowerCase() === key) {
        forget(nonce);
        return { ok: true, ...issueToken(wallet) };
      }
    }
    return { ok: false, code: "bad_signature" };
  }

  /** The session in `token`, or null when it is malformed, tampered with or expired. */
  function verifyToken(token) {
    if (!configured || typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, mac] = parts;
    const given = Buffer.from(mac, "base64url");
    const expected = hmac(payload);
    // Length first (timingSafeEqual needs equal lengths), then a constant-time
    // compare, then the canonical encoding so no two strings pass for one token.
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    if (given.toString("base64url") !== mac) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
    if (!data || data.v !== 1 || typeof data.addr !== "string" || !ethers.isAddress(data.addr)) return null;
    if (!Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp)) return null;
    if (data.exp * 1000 <= now()) return null;
    return { address: ethers.getAddress(data.addr), iat: data.iat, exp: data.exp };
  }

  const timer = setInterval(prune, 60 * 1000);
  timer.unref?.();

  return { configured, issueNonce, verify, verifyToken, prune, nonceCount: () => nonces.size };
}

const NOT_CONFIGURED = "Sign-in isn't set up on the server yet.";
const UNAUTHORIZED = "Sign in with your wallet to continue.";

/**
 * Express middleware: puts { address, iat, exp } on req.session from a Bearer
 * token. Without a usable SESSION_SECRET it answers 503 not_configured; with a
 * missing, tampered or expired token, 401 unauthorized. `optional` lets the
 * request through as anonymous (req.session = null) instead.
 */
function sessionMiddleware(auth, { optional = false } = {}) {
  return (req, res, next) => {
    if (!auth.configured) {
      if (optional) { req.session = null; return next(); }
      return res.status(503).json({ error: NOT_CONFIGURED, code: "not_configured" });
    }
    const header = req.get("authorization") || "";
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const session = m ? auth.verifyToken(m[1]) : null;
    if (!session) {
      if (optional) { req.session = null; return next(); }
      return res.status(401).json({ error: UNAUTHORIZED, code: "unauthorized" });
    }
    req.session = session;
    next();
  };
}

module.exports = {
  SIGN_IN_DOMAIN, SIGN_IN_CHAIN_ID, MIN_SECRET_LENGTH, NONCE_TTL_MS, TOKEN_TTL_MS, NOT_CONFIGURED,
  signInMessage, secretUsable, createAuth, sessionMiddleware,
};
