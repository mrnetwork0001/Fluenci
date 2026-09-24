// Wallet sign-in for the Fluenci Arcade.
//
// POST /auth/nonce hands out a one-time Sign-In with Ethereum (EIP-4361)
// message; the wallet signs it with personal_sign (EIP-191); POST /auth/verify
// takes the nonce (or the exact message) the client received plus the
// signature, and returns a session token that the Arcade routes take as
// "Authorization: Bearer <token>". Signing costs nothing and sends no
// transaction. Only plain wallets (EOAs) can sign in: a contract wallet's
// signature can't be checked with ecrecover.
//
// Token: base64url(JSON {v:1, addr, iat, exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET, first part)).
// No server-side session store: a token is valid until it expires (12 hours),
// and rotating SESSION_SECRET signs everyone out.
"use strict";
const crypto = require("crypto");
const { ethers } = require("ethers");

// The site the wallet is signing in to (EIP-4361 `domain`). SIGNIN_DOMAIN
// overrides it; the app itself is served from www.fluenci.xyz (the apex
// redirects there), which is what a wallet compares the domain with.
const DEFAULT_SIGN_IN_DOMAIN = "www.fluenci.xyz";
const SIGN_IN_CHAIN_ID = 1990;
const SIGN_IN_STATEMENT = "Sign in to the Fluenci Arcade. This does not send a transaction or cost gas.";
const MIN_SECRET_LENGTH = 32;
const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TOKEN_CHARS = 1024;
const MAX_SIGNATURE_CHARS = 200;
const MAX_MESSAGE_CHARS = 2000;

// An RFC 3986 authority without userinfo: a DNS host name and an optional port.
const DOMAIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::\d{1,5})?$/;
const isSignInDomain = (d) => typeof d === "string" && d.length <= 255 && DOMAIN_RE.test(d);
// RFC 3339 date-time, as Date#toISOString writes it (the offset may also be +hh:mm).
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const isDateTime = (s) => DATE_TIME_RE.test(s) && Number.isFinite(Date.parse(s));

/**
 * SIGNIN_DOMAIN as configured: the default when unset, null when it isn't a
 * plain host[:port] (the caller warns and falls back to the default).
 */
function resolveSignInDomain(value) {
  const d = String(value ?? "").trim();
  if (!d) return DEFAULT_SIGN_IN_DOMAIN;
  return isSignInDomain(d) ? d.toLowerCase() : null;
}

/** The exact text a wallet signs to sign in: an EIP-4361 message. */
function signInMessage({ domain = DEFAULT_SIGN_IN_DOMAIN, address, nonce, issuedAt, expiresAt }) {
  return `${domain} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `${SIGN_IN_STATEMENT}\n\n` +
    `URI: https://${domain}\n` +
    "Version: 1\n" +
    `Chain ID: ${SIGN_IN_CHAIN_ID}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expiration Time: ${expiresAt}`;
}

const FIELDS = [["uri", "URI"], ["version", "Version"], ["chainId", "Chain ID"], ["nonce", "Nonce"],
  ["issuedAt", "Issued At"], ["expirationTime", "Expiration Time"]];

/**
 * Parses a sign-in message in the shape signInMessage writes (EIP-4361 with a
 * statement and exactly these fields, in this order). -> { domain, address,
 * statement, uri, version, chainId, nonce, issuedAt, expirationTime } or null
 * when it isn't one: a wrong header, a non-EIP-55 address, a missing blank
 * line, a field out of order, a nonce that isn't 8+ alphanumerics, a date that
 * isn't RFC 3339, anything extra.
 */
function parseSignInMessage(message) {
  if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) return null;
  const lines = message.split("\n");
  if (lines.length !== 5 + FIELDS.length) return null;
  const head = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
  if (!head || !isSignInDomain(head[1])) return null;
  let address;
  try { address = ethers.getAddress(lines[1]); } catch { return null; }
  if (address !== lines[1]) return null; // EIP-55 checksum case is required
  if (lines[2] !== "" || lines[4] !== "" || !lines[3] || lines[3].trim() !== lines[3]) return null;
  const out = { domain: head[1], address, statement: lines[3] };
  for (const [i, [key, tag]] of FIELDS.entries()) {
    const line = lines[5 + i];
    if (!line.startsWith(`${tag}: `)) return null;
    out[key] = line.slice(tag.length + 2);
  }
  if (!/^[a-z][a-z0-9+.-]*:\S+$/i.test(out.uri) || out.version !== "1" || !/^[1-9]\d*$/.test(out.chainId)) return null;
  if (!/^[A-Za-z0-9]{8,}$/.test(out.nonce) || !isDateTime(out.issuedAt) || !isDateTime(out.expirationTime)) return null;
  out.chainId = Number(out.chainId);
  return out;
}

/** A SESSION_SECRET is usable when it is at least 32 characters. */
const secretUsable = (secret) => typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;

/**
 * Everything auth-related for one SESSION_SECRET. With no usable secret,
 * `configured` is false and nothing can be issued or verified.
 *
 * Nonces live in memory for 5 minutes. Each requester (IP) keeps at most
 * `maxPerAddress` pending nonces per wallet; a new one drops that requester's
 * OWN oldest attempt, never anyone else's, and verify finds nonces directly.
 * So nobody can refuse or cancel another person's sign-in by asking for nonces
 * for their wallet, and a person retrying after cancelling in the wallet is
 * never locked out. A full table (`maxNonces`) answers busy until some expire.
 */
function createAuth({
  secret = "",
  domain = DEFAULT_SIGN_IN_DOMAIN,
  now = Date.now,
  nonceTtlMs = NONCE_TTL_MS,
  tokenTtlMs = TOKEN_TTL_MS,
  maxNonces = 20000,
  maxPerAddress = 5,
} = {}) {
  if (!isSignInDomain(domain)) throw new Error(`Invalid sign-in domain: ${domain}`);
  const configured = secretUsable(secret);
  const nonces = new Map();     // nonce -> { key, message, expiresAt }
  const byBucket = new Map();   // "<lowercase address>|<requester>" -> [nonce, ...], oldest first

  const hmac = (payload) => crypto.createHmac("sha256", secret).update(payload).digest();

  function forget(nonce, bucket = nonces.get(nonce)?.bucket) {
    nonces.delete(nonce);
    if (!bucket) return;
    const list = (byBucket.get(bucket) || []).filter((n) => n !== nonce);
    if (list.length) byBucket.set(bucket, list);
    else byBucket.delete(bucket);
  }

  function prune() {
    const t = now();
    for (const [nonce, entry] of nonces) if (entry.expiresAt <= t) forget(nonce);
  }

  /** The nonces still live in one bucket (expired ones are dropped on the way). */
  function liveFor(bucket) {
    const t = now();
    for (const n of [...(byBucket.get(bucket) || [])]) {
      const e = nonces.get(n);
      if (!e || e.expiresAt <= t) forget(n, bucket);
    }
    return [...(byBucket.get(bucket) || [])];
  }

  /**
   * A fresh sign-in message for `address` (any valid address), asked for by
   * `requester` (the client IP; "" in tests).
   * -> { ok: true, message, nonce, expiresAt } | { ok: false, code: "busy" }
   */
  function issueNonce(address, requester = "") {
    if (!configured) throw new Error("SESSION_SECRET not configured");
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();
    const bucket = `${key}|${requester}`;
    // Only this requester's own oldest attempt for this wallet ever makes room.
    let live = liveFor(bucket);
    while (live.length >= maxPerAddress) {
      forget(live[0], bucket);
      live = liveFor(bucket);
    }
    if (nonces.size >= maxNonces) prune();
    if (nonces.size >= maxNonces) return { ok: false, code: "busy" };

    const nonce = crypto.randomBytes(16).toString("hex"); // 128 bits
    const issued = now();
    const issuedAt = new Date(issued).toISOString();
    const expiresAt = new Date(issued + nonceTtlMs).toISOString();
    const message = signInMessage({ domain, address: wallet, nonce, issuedAt, expiresAt });
    nonces.set(nonce, { key, bucket, message, expiresAt: issued + nonceTtlMs });
    byBucket.set(bucket, [...(byBucket.get(bucket) || []), nonce]);
    return { ok: true, message, nonce, expiresAt };
  }

  function issueToken(address) {
    const iat = Math.floor(now() / 1000);
    const exp = iat + Math.floor(tokenTtlMs / 1000);
    const payload = Buffer.from(JSON.stringify({ v: 1, addr: address, iat, exp })).toString("base64url");
    const token = `${payload}.${hmac(payload).toString("base64url")}`;
    return { token, address, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /**
   * Checks `signature` against the sign-in message this server issued with
   * `nonce`, looked up directly (so no other request can have displaced it).
   * `message`, when given, must be exactly that message, and names the nonce
   * when `nonce` is left out.
   * -> { ok: true, token, address, expiresAt }
   *  | { ok: false, code: "bad_request" | "bad_message" | "expired_nonce" | "bad_signature" }
   * A matching nonce is used up; a failed signature leaves it for a retry.
   */
  function verify({ address, signature, nonce, message } = {}) {
    if (!configured) throw new Error("SESSION_SECRET not configured");
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();

    let id = typeof nonce === "string" && nonce ? nonce : null;
    if (message !== undefined && message !== null) {
      const parsed = parseSignInMessage(message);
      if (!parsed || (id !== null && parsed.nonce !== id)) return { ok: false, code: "bad_message" };
      id = parsed.nonce;
    }
    if (!id) return { ok: false, code: "bad_request" };

    const entry = nonces.get(id);
    if (!entry || entry.expiresAt <= now()) return { ok: false, code: "expired_nonce" };
    if (entry.key !== key) return { ok: false, code: "bad_request" }; // issued for another wallet
    if (message !== undefined && message !== null && message !== entry.message) return { ok: false, code: "bad_message" };
    if (typeof signature !== "string" || signature.length > MAX_SIGNATURE_CHARS) return { ok: false, code: "bad_signature" };

    let signer = null;
    try { signer = ethers.verifyMessage(entry.message, signature); } catch { signer = null; }
    if (!signer || signer.toLowerCase() !== key) return { ok: false, code: "bad_signature" };
    forget(id);
    return { ok: true, ...issueToken(wallet) };
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

  return { configured, domain, issueNonce, verify, verifyToken, prune, nonceCount: () => nonces.size };
}

const NOT_CONFIGURED = "Sign-in isn't set up on the server yet.";
const UNAUTHORIZED = "Sign in with your wallet to continue.";

/**
 * Express middleware: puts { address, iat, exp } on req.session from a Bearer
 * token. Without a usable SESSION_SECRET it answers 503 not_configured; with a
 * missing, tampered or expired token, 401 unauthorized.
 *
 * `optional` lets a request with NO Authorization header through as anonymous
 * (req.session = null), even without a SESSION_SECRET. A request that does send
 * one still gets 401 when it can't be accepted, so the client learns its
 * sign-in is gone instead of being answered as someone signed out.
 */
function sessionMiddleware(auth, { optional = false } = {}) {
  return (req, res, next) => {
    const header = (req.get("authorization") || "").trim();
    if (optional && !header) { req.session = null; return next(); }
    if (!auth.configured && !optional) {
      return res.status(503).json({ error: NOT_CONFIGURED, code: "not_configured" });
    }
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const session = m ? auth.verifyToken(m[1]) : null;
    if (!session) return res.status(401).json({ error: UNAUTHORIZED, code: "unauthorized" });
    req.session = session;
    next();
  };
}

module.exports = {
  DEFAULT_SIGN_IN_DOMAIN, SIGN_IN_CHAIN_ID, SIGN_IN_STATEMENT, MIN_SECRET_LENGTH, NONCE_TTL_MS, TOKEN_TTL_MS, NOT_CONFIGURED,
  signInMessage, parseSignInMessage, resolveSignInDomain, isSignInDomain, secretUsable, createAuth, sessionMiddleware,
};
