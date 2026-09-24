import { getAddress, verifyMessage } from "ethers";

/**
 * Fluenci Arcade: the app's side of the server's Arcade API - wallet sign-in,
 * Snake tickets and scores, and the weekly leaderboard. Plain functions with no
 * React, so a test can send exactly the requests the app sends.
 *
 * Nothing here throws for an HTTP or network failure. Each call returns
 * { ok: true, ... } or { ok: false, status, code, message, unauthorized }, where
 * `message` is copy the Arcade can show as is and `unauthorized` (a 401) means
 * the sign-in is no longer valid. status 0 means the server couldn't be reached.
 */

const REQUEST_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 8000;      // a player is waiting on the Play button
const FINISH_TIMEOUT_MS = 20000;    // a long game's turn log is a bigger upload
const SIGN_TIMEOUT_MS = 120000;     // time to open the wallet (or a phone) and approve

const NETWORK = "Couldn't reach the Fluenci server. Check your connection and try again.";
const WALLET_SILENT = "Your wallet didn't respond. Open it, approve or reject any pending request, then try again.";

/**
 * The site the server's sign-in message names (server/auth.js, SIGNIN_DOMAIN).
 * The app also accepts a message for the host it is running on (a local
 * server's SIGNIN_DOMAIN); anything else is refused before the wallet is asked.
 */
export const SIGN_IN_DOMAIN = "www.fluenci.xyz";
export const SIGN_IN_CHAIN_ID = 1990;

export const sameAddress = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** "2026-W39" -> "Week 39"; anything else is shown as it came. */
export function weekLabel(week) {
  const m = /^\d{4}-W(\d{2})$/.exec(week || "");
  return m ? `Week ${Number(m[1])}` : (week || "");
}

/** fetch + JSON with a timeout. -> { status, data }, status 0 when the server couldn't be reached. */
export async function requestJson(apiBase, path, { method = "GET", token = null, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

// The server's own wording, when it is short enough to show.
const serverText = (data) => (typeof data?.error === "string" && data.error.length < 200 ? data.error : null);

/** A failed call as { ok: false, ... }, worded from `copy` (by error code), then by status. */
function failure(r, copy, fallback) {
  const code = typeof r.data?.code === "string" ? r.data.code : null;
  const entry = code ? copy[code] : null;
  let message;
  if (r.status === 0) message = NETWORK;
  else if (entry) message = typeof entry === "function" ? entry(r.data) : entry;
  else if (r.status === 404) message = "This isn't available on the Fluenci server yet.";
  else if (r.status === 429) message = serverText(r.data) || "Too many requests right now. Wait a few minutes and try again.";
  else message = fallback;
  return { ok: false, status: r.status, code, message, unauthorized: r.status === 401 };
}

// --- sign-in ------------------------------------------------------------------

const SIGN_IN_FIELDS = ["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time"];
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The domains a sign-in message may name: Fluenci's, and the host this page runs on. */
function signInDomains() {
  const host = typeof globalThis.location?.host === "string" ? globalThis.location.host.toLowerCase() : "";
  return host ? [SIGN_IN_DOMAIN, host] : [SIGN_IN_DOMAIN];
}

/**
 * Is `message` a Fluenci Arcade sign-in (EIP-4361, as server/auth.js writes it)
 * for exactly this wallet? It must name an allowed domain with the matching
 * "URI: https://<domain>", Version 1, Chain ID 1990 and - when given - the
 * `nonce` the server sent with it. Checked before the wallet is asked to sign
 * anything the server sent.
 */
export function isSignInMessage(message, address, { nonce = null, domains = signInDomains() } = {}) {
  if (typeof message !== "string" || message.length > 2000) return false;
  let wallet;
  try { wallet = getAddress(String(address).toLowerCase()); } catch { return false; }
  const lines = message.split("\n");
  if (lines.length !== 5 + SIGN_IN_FIELDS.length) return false;
  const head = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
  const domain = head ? head[1].toLowerCase() : "";
  if (!domain || !domains.map((d) => String(d).toLowerCase()).includes(domain)) return false;
  if (lines[1] !== wallet || lines[2] !== "" || !lines[3].trim() || lines[4] !== "") return false;
  const f = {};
  for (const [i, tag] of SIGN_IN_FIELDS.entries()) {
    const line = lines[5 + i];
    if (!line.startsWith(`${tag}: `)) return false;
    f[tag] = line.slice(tag.length + 2);
  }
  if (f.URI.toLowerCase() !== `https://${domain}` || f.Version !== "1" || f["Chain ID"] !== String(SIGN_IN_CHAIN_ID)) return false;
  if (!/^[A-Za-z0-9]{8,}$/.test(f.Nonce) || (nonce !== null && f.Nonce !== nonce)) return false;
  return DATE_TIME_RE.test(f["Issued At"]) && DATE_TIME_RE.test(f["Expiration Time"]);
}

const SIGN_IN_COPY = {
  not_configured: "Sign-in isn't set up on the Fluenci server yet.",
  expired_nonce: "The server no longer has this sign-in request (it expired, was already used, or the server restarted). Try again.",
  bad_signature: "The server couldn't match the signature to this wallet. Try again. Smart-contract wallets can't sign in to the Arcade.",
  bad_message: "The server didn't accept the signed sign-in message. Try again.",
  bad_request: "Sign-in didn't work for this wallet. Reconnect it and try again.",
  rate_address: (d) => serverText(d) || "This wallet already has several sign-in requests waiting. Wait a few minutes and try again.",
  busy: (d) => serverText(d) || "Too many sign-ins are in progress on the Fluenci server. Try again in a few minutes.",
  rate_ip: (d) => serverText(d) || "Too many sign-ins from your network. Wait a few minutes and try again.",
};

const isRejection = (e) =>
  e?.code === 4001 || e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001 ||
  /reject|denied|cancel/i.test(e?.message || "");

const TIMED_OUT = Symbol("wallet timed out");
function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(TIMED_OUT), ms); })])
    .finally(() => clearTimeout(t));
}

/**
 * The whole sign-in: a one-time message from the server, ONE signature from the
 * wallet (`sign(message)` resolves to the signature), then a session token. The
 * nonce and the exact message that were signed go back with the signature, so
 * the server checks it against that very request.
 * -> { ok: true, token, address, expiresAt } | { ok: false, message, rejected? }
 */
export async function signInToArcade({ apiBase, address, sign, signTimeoutMs = SIGN_TIMEOUT_MS, domains }) {
  const n = await requestJson(apiBase, "/auth/nonce", { method: "POST", body: { address } });
  if (n.status !== 200) return failure(n, SIGN_IN_COPY, "Sign-in didn't work. Try again in a moment.");
  const message = n.data?.message;
  const nonce = n.data?.nonce;
  if (typeof nonce !== "string" || !isSignInMessage(message, address, { nonce, ...(domains ? { domains } : {}) })) {
    return { ok: false, message: "The server sent an unexpected sign-in message, so nothing was signed." };
  }

  let signature;
  try {
    signature = await withTimeout(Promise.resolve().then(() => sign(message)), signTimeoutMs);
  } catch (e) {
    if (e === TIMED_OUT) return { ok: false, message: WALLET_SILENT };
    if (isRejection(e)) return { ok: false, rejected: true, message: "Sign-in was cancelled in your wallet." };
    if (e?.message === "No wallet found") return { ok: false, message: "No wallet found. Connect your wallet and try again." };
    return { ok: false, message: "Your wallet couldn't sign the sign-in message. Try again." };
  }

  // A wallet can sign with a different account than the one connected here.
  let signer = null;
  try { signer = verifyMessage(message, signature); } catch { /* not a signature at all */ }
  if (!sameAddress(signer, address)) {
    return {
      ok: false,
      message: `That signature wasn't made by ${shortAddress(getAddress(String(address).toLowerCase()))}. ` +
        "Check that your wallet is using this account and try again. Smart-contract wallets can't sign in to the Arcade.",
    };
  }

  const v = await requestJson(apiBase, "/auth/verify", { method: "POST", body: { address, nonce, message, signature } });
  if (v.status !== 200) return failure(v, SIGN_IN_COPY, "Sign-in didn't work. Try again in a moment.");
  const { token, expiresAt } = v.data || {};
  if (typeof token !== "string" || !token || !sameAddress(v.data?.address, address) || !Number.isFinite(Date.parse(expiresAt))) {
    return { ok: false, message: "The server's sign-in reply couldn't be used. Try again." };
  }
  return { ok: true, token, address: v.data.address, expiresAt };
}

// --- Snake rounds -------------------------------------------------------------

const NOT_SET_UP = "The leaderboard isn't set up on the Fluenci server yet.";

const START_COPY = {
  no_pass: (d) => (d?.reason === "unavailable"
    ? "The server couldn't check your Arcade Pass just now."
    : "The server doesn't see a valid Arcade Pass for this wallet right now. If you just started or fixed it, try again in a minute."),
  unauthorized: "Your Arcade sign-in has ended. Sign in again to get back on the board.",
  not_configured: NOT_SET_UP,
  rate_address: (d) => serverText(d) || "You've started a lot of rounds in the last hour. Take a short break and try again.",
  rate_ip: (d) => serverText(d) || "Too many requests from your network. Wait a few minutes and try again.",
};

/** A ticket and seed for a scored round. -> { ok: true, ticket, seed } | failure */
export async function startSnakeRound({ apiBase, token }) {
  const r = await requestJson(apiBase, "/arcade/snake/start", { method: "POST", token, timeoutMs: START_TIMEOUT_MS });
  const d = r.data;
  if (r.status === 200 && typeof d?.ticket === "string" && d.ticket && Number.isSafeInteger(d.seed) && d.seed >= 0) {
    return { ok: true, ticket: d.ticket, seed: d.seed };
  }
  return failure(r, START_COPY, "The server couldn't start a scored round right now.");
}

const FINISH_COPY = {
  bad_ticket: "The server no longer has this round's ticket (already used, expired, or the server restarted), so the score wasn't recorded.",
  mismatch: "The server's replay of this round came out differently, so the score wasn't recorded.",
  too_fast: "The server's replay says this round ended faster than it can be played, so the score wasn't recorded.",
  too_long: "This round ran past the 30-minute limit for scored rounds, so it wasn't recorded.",
  unauthorized: "Your Arcade sign-in ended during this round, so the score wasn't recorded.",
  not_configured: NOT_SET_UP,
  rate_ip: (d) => serverText(d) || "Too many requests from your network, so the score wasn't recorded.",
};

/**
 * Sends a finished round for the server to replay.
 * -> { ok: true, score, best, rank, week } (rank null while nothing is listed) | failure
 */
export async function finishSnakeRound({ apiBase, token, ticket, inputs, score, durationMs }) {
  const r = await requestJson(apiBase, "/arcade/snake/finish", {
    method: "POST", token, body: { ticket, inputs, score, durationMs }, timeoutMs: FINISH_TIMEOUT_MS,
  });
  const d = r.data;
  if (r.status === 200 && d?.accepted === true && Number.isSafeInteger(d.score)) {
    return {
      ok: true,
      score: d.score,
      best: Number.isSafeInteger(d.best) ? d.best : d.score,
      rank: Number.isSafeInteger(d.rank) ? d.rank : null,
      week: typeof d.week === "string" ? d.week : "",
    };
  }
  // No answer: the server may still have recorded it, so don't say it didn't.
  if (r.status === 0) return { ok: false, status: 0, code: null, message: "Couldn't reach the Fluenci server, so this score may not have been recorded.", unauthorized: false };
  return failure(r, FINISH_COPY, "The score couldn't be recorded right now.");
}

// --- leaderboard --------------------------------------------------------------

/**
 * This week's board. With a token the server adds the caller's own standing
 * (`you`). A token the server no longer accepts is a 401 (`unauthorized` in the
 * failure): the caller drops the sign-in and reads the public board.
 * -> { ok: true, week, entries: [{ address, score }], you: { best, rank } | null } | failure
 */
export async function fetchLeaderboard({ apiBase, token = null }) {
  const r = await requestJson(apiBase, "/arcade/leaderboard", { token });
  const d = r.data;
  if (r.status !== 200 || !d || !Array.isArray(d.entries)) return failure(r, {}, "The leaderboard isn't available right now.");
  const entries = d.entries
    .filter((e) => e && typeof e.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(e.address) && Number.isSafeInteger(e.score))
    .slice(0, 20)
    .map((e) => ({ address: e.address, score: e.score }));
  const you = d.you && Number.isSafeInteger(d.you.best) && Number.isSafeInteger(d.you.rank)
    ? { best: d.you.best, rank: d.you.rank }
    : null;
  return { ok: true, week: typeof d.week === "string" ? d.week : "", entries, you };
}
