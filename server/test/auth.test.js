"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const {
  createAuth, signInMessage, parseSignInMessage, resolveSignInDomain, sessionMiddleware,
  NONCE_TTL_MS, TOKEN_TTL_MS, DEFAULT_SIGN_IN_DOMAIN, SIGN_IN_STATEMENT,
} = require("../auth");

const SECRET = "test-secret-0123456789-abcdefghijklmnop"; // 38 chars, test only
const alice = ethers.Wallet.createRandom();
const bob = ethers.Wallet.createRandom();

function fixture(start = Date.UTC(2026, 8, 24, 12, 0, 0), opts = {}) {
  const clock = { t: start };
  const auth = createAuth({ secret: SECRET, now: () => clock.t, ...opts });
  return { auth, clock };
}

/** Sign the message a nonce came with, and verify it the way the app does (nonce + message). */
async function signIn(auth, wallet, issued = auth.issueNonce(wallet.address)) {
  const signature = await wallet.signMessage(issued.message);
  return auth.verify({ address: wallet.address, nonce: issued.nonce, message: issued.message, signature });
}

test("F4: the sign-in message is EIP-4361, for www.fluenci.xyz by default", () => {
  const { auth, clock } = fixture();
  const issued = auth.issueNonce(alice.address.toLowerCase());
  const { message, nonce, expiresAt } = issued;
  assert.equal(issued.ok, true);
  assert.match(nonce, /^[0-9a-f]{32}$/, "128-bit hex nonce");
  const issuedAt = new Date(clock.t).toISOString();
  assert.equal(expiresAt, new Date(clock.t + NONCE_TTL_MS).toISOString());
  assert.equal(message,
    "www.fluenci.xyz wants you to sign in with your Ethereum account:\n" +
    `${alice.address}\n` +
    "\n" +
    "Sign in to the Fluenci Arcade. This does not send a transaction or cost gas.\n" +
    "\n" +
    "URI: https://www.fluenci.xyz\n" +
    "Version: 1\n" +
    "Chain ID: 1990\n" +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expiration Time: ${expiresAt}`);
  assert.equal(message, signInMessage({ address: alice.address, nonce, issuedAt, expiresAt }));
  assert.equal(DEFAULT_SIGN_IN_DOMAIN, "www.fluenci.xyz");
  assert.notEqual(auth.issueNonce(alice.address).nonce, nonce, "nonces are random");

  // The parser reads every EIP-4361 field back.
  assert.deepEqual(parseSignInMessage(message), {
    domain: "www.fluenci.xyz", address: alice.address, statement: SIGN_IN_STATEMENT,
    uri: "https://www.fluenci.xyz", version: "1", chainId: 1990, nonce, issuedAt, expirationTime: expiresAt,
  });
});

test("F4: SIGNIN_DOMAIN sets the domain and the URI line; a bad value is refused", () => {
  assert.equal(resolveSignInDomain(undefined), "www.fluenci.xyz");
  assert.equal(resolveSignInDomain(""), "www.fluenci.xyz");
  assert.equal(resolveSignInDomain("  Staging.Fluenci.xyz "), "staging.fluenci.xyz");
  assert.equal(resolveSignInDomain("localhost:5173"), "localhost:5173");
  for (const bad of ["https://www.fluenci.xyz", "www.fluenci.xyz/", "a b", "evil.example/path", "-x.com", "x..com", "user@host"]) {
    assert.equal(resolveSignInDomain(bad), null, bad);
  }
  assert.throws(() => createAuth({ secret: SECRET, domain: "https://x.y" }));

  const { auth } = fixture(undefined, { domain: "localhost:5173" });
  const { message } = auth.issueNonce(alice.address);
  const parsed = parseSignInMessage(message);
  assert.equal(parsed.domain, "localhost:5173");
  assert.equal(parsed.uri, "https://localhost:5173");
  assert.ok(message.startsWith("localhost:5173 wants you to sign in with your Ethereum account:\n"));
});

test("F4: the parser refuses anything that isn't exactly that shape", () => {
  const { auth } = fixture();
  const { message } = auth.issueNonce(alice.address);
  assert.ok(parseSignInMessage(message));
  const lines = message.split("\n");
  const swap = (i, v) => lines.map((l, j) => (j === i ? v : l)).join("\n");
  const cases = {
    "old wording": message.replace("your Ethereum account:", "your wallet:"),
    "lowercase address (not EIP-55)": swap(1, alice.address.toLowerCase()),
    "bad address": swap(1, "0x1234"),
    "no blank line after the address": swap(2, "x"),
    "empty statement": swap(3, ""),
    "no blank line after the statement": swap(4, "x"),
    "no URI": swap(5, "URL: https://www.fluenci.xyz"),
    "version 2": swap(6, "Version: 2"),
    "chain id not a number": swap(7, "Chain ID: one"),
    "short nonce": swap(8, "Nonce: abc"),
    "nonce with symbols": swap(8, "Nonce: abcdefgh-123"),
    "issued at not a date": swap(9, "Issued At: yesterday"),
    "expiration not a date": swap(10, "Expiration Time: 2026-13-45T99:00:00Z"),
    "fields out of order": [...lines.slice(0, 5), lines[6], lines[5], ...lines.slice(7)].join("\n"),
    "extra field": `${message}\nNot Before: ${new Date().toISOString()}`,
    "trailing newline": `${message}\n`,
    "domain with a path": message.replace("www.fluenci.xyz wants", "www.fluenci.xyz/x wants"),
    "CRLF line ends": message.replace(/\n/g, "\r\n"),
  };
  for (const [name, m] of Object.entries(cases)) assert.equal(parseSignInMessage(m), null, name);
  assert.equal(parseSignInMessage(null), null);
  assert.equal(parseSignInMessage("x".repeat(3000)), null);
});

test("good signature -> token for that wallet, valid for 12 hours", async () => {
  const { auth, clock } = fixture();
  const r = await signIn(auth, alice);
  assert.equal(r.ok, true);
  assert.equal(r.address, alice.address);
  assert.equal(r.expiresAt, new Date(clock.t + TOKEN_TTL_MS).toISOString());
  const [payload, mac] = r.token.split(".");
  assert.ok(payload && mac);
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.deepEqual(Object.keys(data).sort(), ["addr", "exp", "iat", "v"]);
  assert.equal(data.v, 1);
  assert.equal(data.exp - data.iat, 12 * 3600);
  assert.deepEqual(auth.verifyToken(r.token), { address: alice.address, iat: data.iat, exp: data.exp });
});

test("F3: verify takes the nonce, or the exact message, the client was given", async () => {
  const { auth } = fixture();
  // The nonce alone.
  const a = auth.issueNonce(alice.address);
  const sigA = await alice.signMessage(a.message);
  assert.equal(auth.verify({ address: alice.address, nonce: a.nonce, signature: sigA }).ok, true);
  // The message alone: the server reads the nonce out of it.
  const b = auth.issueNonce(alice.address);
  assert.equal(auth.verify({ address: alice.address, message: b.message, signature: await alice.signMessage(b.message) }).ok, true);
  // Neither: nothing to look up.
  const c = auth.issueNonce(alice.address);
  const sigC = await alice.signMessage(c.message);
  assert.deepEqual(auth.verify({ address: alice.address, signature: sigC }), { ok: false, code: "bad_request" });
  // A message that isn't the one issued with that nonce, or doesn't match the nonce sent.
  const edited = c.message.replace("Sign in to the Fluenci Arcade.", "Sign in to the Fluenci Arcade!");
  assert.deepEqual(auth.verify({ address: alice.address, nonce: c.nonce, message: edited, signature: sigC }), { ok: false, code: "bad_message" });
  assert.deepEqual(auth.verify({ address: alice.address, nonce: a.nonce, message: c.message, signature: sigC }), { ok: false, code: "bad_message" });
  assert.deepEqual(auth.verify({ address: alice.address, message: "hello", signature: sigC }), { ok: false, code: "bad_message" });
  // A nonce issued for another wallet.
  const forBob = auth.issueNonce(bob.address);
  assert.deepEqual(auth.verify({ address: alice.address, nonce: forBob.nonce, signature: await alice.signMessage(forBob.message) }),
    { ok: false, code: "bad_request" });
  // A nonce that was never issued.
  assert.deepEqual(auth.verify({ address: alice.address, nonce: "f".repeat(32), signature: sigC }), { ok: false, code: "expired_nonce" });
  // None of that used up c: it still signs in.
  assert.equal(auth.verify({ address: alice.address, nonce: c.nonce, message: c.message, signature: sigC }).ok, true);
});

test("wrong address: a signature from another wallet is refused", async () => {
  const { auth } = fixture();
  // Bob signs the message issued for Alice's address.
  const issued = auth.issueNonce(alice.address);
  const { message, nonce } = issued;
  assert.deepEqual(auth.verify({ address: alice.address, nonce, message, signature: await bob.signMessage(message) }),
    { ok: false, code: "bad_signature" });
  // A signature over some other text, and junk.
  assert.deepEqual(auth.verify({ address: alice.address, nonce, signature: await alice.signMessage("hello") }), { ok: false, code: "bad_signature" });
  assert.deepEqual(auth.verify({ address: alice.address, nonce, signature: "0x1234" }), { ok: false, code: "bad_signature" });
  assert.deepEqual(auth.verify({ address: alice.address, nonce, signature: 42 }), { ok: false, code: "bad_signature" });
  // A failed attempt doesn't burn the nonce: Alice can still sign in with it.
  assert.equal((await signIn(auth, alice, issued)).ok, true);
});

test("reused nonce: the same signature can't sign in twice", async () => {
  const { auth } = fixture();
  const issued = auth.issueNonce(alice.address);
  const signature = await alice.signMessage(issued.message);
  const body = { address: alice.address, nonce: issued.nonce, message: issued.message, signature };
  assert.equal(auth.verify(body).ok, true);
  assert.deepEqual(auth.verify(body), { ok: false, code: "expired_nonce" });
  // Even with a newer nonce outstanding, the old signature doesn't match it.
  const newer = auth.issueNonce(alice.address);
  assert.deepEqual(auth.verify({ address: alice.address, nonce: newer.nonce, signature }), { ok: false, code: "bad_signature" });
});

test("expired nonce: 5 minutes is the limit", async () => {
  const { auth, clock } = fixture();
  const issued = auth.issueNonce(alice.address);
  const signature = await alice.signMessage(issued.message);
  clock.t += NONCE_TTL_MS;
  assert.deepEqual(auth.verify({ address: alice.address, nonce: issued.nonce, signature }), { ok: false, code: "expired_nonce" });

  const again = auth.issueNonce(alice.address);
  clock.t += NONCE_TTL_MS - 1;
  assert.equal((await signIn(auth, alice, again)).ok, true, "just inside the window");
});

test("F3: pending nonces are kept per wallet AND requester; a requester only ever displaces its own", async () => {
  const clock = { t: 1_800_000_000_000 };
  const auth = createAuth({ secret: SECRET, now: () => clock.t, maxPerAddress: 5 });
  // The victim opens a sign-in; while the wallet prompt is up, someone else floods nonces for the same wallet.
  const victim = auth.issueNonce(alice.address, "10.0.0.1");
  const flood = [];
  for (let i = 0; i < 10; i++) flood.push(auth.issueNonce(alice.address, "10.6.6.6"));
  assert.ok(flood.every((r) => r.ok), "nobody is refused");
  // The victim's pending sign-in is untouched and still finishes.
  assert.equal((await signIn(auth, alice, victim)).ok, true);
  // The flooder's own oldest attempts made room for its newer ones (5 kept per requester and wallet).
  assert.deepEqual(await signIn(auth, alice, flood[0]), { ok: false, code: "expired_nonce" });
  assert.equal((await signIn(auth, alice, flood[9])).ok, true);
  // Someone retrying from one place (e.g. after cancelling in the wallet) is never locked out.
  for (let i = 0; i < 8; i++) assert.equal(auth.issueNonce(bob.address, "10.0.0.2").ok, true);
  // Expired nonces go too.
  clock.t += NONCE_TTL_MS;
  assert.equal(auth.issueNonce(alice.address, "10.6.6.6").ok, true);
});

test("F3: a full nonce table refuses new requests (busy) and never drops pending ones", async () => {
  const clock = { t: 1_800_000_000_000 };
  const auth = createAuth({ secret: SECRET, now: () => clock.t, maxNonces: 8 });
  const first = auth.issueNonce(alice.address);
  for (let i = 0; i < 7; i++) assert.equal(auth.issueNonce(ethers.Wallet.createRandom().address).ok, true);
  assert.equal(auth.nonceCount(), 8);
  assert.deepEqual(auth.issueNonce(bob.address), { ok: false, code: "busy" });
  assert.equal(auth.nonceCount(), 8, "total capped");
  assert.equal((await signIn(auth, alice, first)).ok, true, "the oldest pending nonce still works");
  assert.equal(auth.issueNonce(bob.address).ok, true, "a used nonce frees room");
  assert.equal(auth.nonceCount(), 8);
  clock.t += NONCE_TTL_MS;
  assert.equal(auth.issueNonce(ethers.Wallet.createRandom().address).ok, true, "a full table of expired nonces is pruned first");
  assert.equal(auth.nonceCount(), 1);
  auth.issueNonce(bob.address);
  clock.t += NONCE_TTL_MS;
  auth.prune();
  assert.equal(auth.nonceCount(), 0, "expired nonces are pruned");
});

test("tampered token: any change to the payload or MAC is refused", async () => {
  const { auth } = fixture();
  const { token } = await signIn(auth, alice);
  const [payload, mac] = token.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());

  const forged = Buffer.from(JSON.stringify({ ...data, addr: bob.address })).toString("base64url");
  assert.equal(auth.verifyToken(`${forged}.${mac}`), null, "payload swapped to another wallet");
  const longer = Buffer.from(JSON.stringify({ ...data, exp: data.exp + 86400 * 365 })).toString("base64url");
  assert.equal(auth.verifyToken(`${longer}.${mac}`), null, "expiry extended");
  const flipped = mac.slice(0, -2) + (mac.at(-2) === "A" ? "B" : "A") + mac.at(-1);
  assert.equal(auth.verifyToken(`${payload}.${flipped}`), null, "MAC changed");
  assert.equal(auth.verifyToken(`${payload}.${mac}=`), null, "non-canonical MAC encoding");
  assert.equal(auth.verifyToken(`${payload}.${mac}.x`), null, "extra part");
  assert.equal(auth.verifyToken(payload), null, "no MAC");
  assert.equal(auth.verifyToken(""), null);
  assert.equal(auth.verifyToken(null), null);

  // Signed with a different secret.
  const other = createAuth({ secret: `${SECRET}-other` });
  assert.equal(other.verifyToken(token), null);
  // A correctly MAC'd payload that isn't a session.
  const hmac = (p) => require("crypto").createHmac("sha256", SECRET).update(p).digest("base64url");
  const bad = Buffer.from(JSON.stringify({ v: 2, addr: alice.address, iat: data.iat, exp: data.exp })).toString("base64url");
  assert.equal(auth.verifyToken(`${bad}.${hmac(bad)}`), null, "unknown version");
  assert.deepEqual(auth.verifyToken(token)?.address, alice.address, "the untouched token still works");
});

test("expired token: refused after 12 hours", async () => {
  const { auth, clock } = fixture();
  const { token } = await signIn(auth, alice);
  clock.t += TOKEN_TTL_MS - 1000;
  assert.equal(auth.verifyToken(token)?.address, alice.address);
  clock.t += 1000;
  assert.equal(auth.verifyToken(token), null);
});

test("missing or short SESSION_SECRET: nothing is configured", () => {
  for (const secret of ["", undefined, "x".repeat(31)]) {
    const auth = createAuth({ secret });
    assert.equal(auth.configured, false);
    assert.throws(() => auth.issueNonce(alice.address));
    assert.throws(() => auth.verify({ address: alice.address, nonce: "a".repeat(32), signature: "0x" }));
    assert.equal(auth.verifyToken("a.b"), null);
  }
  assert.equal(createAuth({ secret: "x".repeat(32) }).configured, true);
});

test("F7: optional sessions - no header is anonymous, a header that can't be accepted is 401", async () => {
  const { auth } = fixture(Date.now());
  const { token } = await signIn(auth, alice);
  const run = (mw, header) => {
    const req = { get: (h) => (h.toLowerCase() === "authorization" ? header : undefined) };
    const out = { status: 200, body: null, next: false };
    const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
    mw(req, res, () => { out.next = true; out.session = req.session; });
    return out;
  };
  const optional = sessionMiddleware(auth, { optional: true });
  assert.deepEqual(run(optional, undefined), { status: 200, body: null, next: true, session: null });
  assert.deepEqual(run(optional, "  "), { status: 200, body: null, next: true, session: null }, "an empty header counts as none");
  assert.equal(run(optional, `Bearer ${token}`).session.address, alice.address);
  for (const header of ["Bearer x.y", `Bearer ${token}x`, "Basic abc", "Bearer"]) {
    const r = run(optional, header);
    assert.deepEqual([r.status, r.body?.code, r.next], [401, "unauthorized", false], header);
  }
  // No SESSION_SECRET: still public without a header, and a sent token can't be accepted.
  const off = sessionMiddleware(createAuth({ secret: "" }), { optional: true });
  assert.equal(run(off, undefined).next, true);
  assert.deepEqual([run(off, `Bearer ${token}`).status, run(off, `Bearer ${token}`).body.code], [401, "unauthorized"]);
  // Required sessions are unchanged: 503 without a secret, 401 without a token.
  assert.equal(run(sessionMiddleware(createAuth({ secret: "" })), `Bearer ${token}`).status, 503);
  assert.equal(run(sessionMiddleware(auth), undefined).status, 401);
});
