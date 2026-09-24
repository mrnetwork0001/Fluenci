"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { createAuth, signInMessage, NONCE_TTL_MS, TOKEN_TTL_MS } = require("../auth");

const SECRET = "test-secret-0123456789-abcdefghijklmnop"; // 38 chars, test only
const alice = ethers.Wallet.createRandom();
const bob = ethers.Wallet.createRandom();

function fixture(start = Date.UTC(2026, 8, 24, 12, 0, 0)) {
  const clock = { t: start };
  const auth = createAuth({ secret: SECRET, now: () => clock.t });
  return { auth, clock };
}

test("the sign-in message is exactly the contract's text", () => {
  const { auth, clock } = fixture();
  const { message, nonce, expiresAt } = auth.issueNonce(alice.address.toLowerCase());
  assert.match(nonce, /^[0-9a-f]{32}$/, "128-bit hex nonce");
  const issuedAt = new Date(clock.t).toISOString();
  assert.equal(expiresAt, new Date(clock.t + NONCE_TTL_MS).toISOString());
  assert.equal(message,
    "fluenci.xyz wants you to sign in with your wallet:\n" +
    `${alice.address}\n\n` +
    "Sign in to the Fluenci Arcade. This does not send a transaction or cost gas.\n\n" +
    "Chain ID: 1990\n" +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expiration Time: ${expiresAt}`);
  assert.equal(message, signInMessage({ address: alice.address, nonce, issuedAt, expiresAt }));
  assert.notEqual(auth.issueNonce(alice.address).nonce, nonce, "nonces are random");
});

test("good signature -> token for that wallet, valid for 12 hours", async () => {
  const { auth, clock } = fixture();
  const { message } = auth.issueNonce(alice.address);
  const r = auth.verify(alice.address, await alice.signMessage(message));
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

test("wrong address: a signature from another wallet is refused", async () => {
  const { auth } = fixture();
  // Bob signs the message issued for Alice's address.
  const { message } = auth.issueNonce(alice.address);
  const r = auth.verify(alice.address, await bob.signMessage(message));
  assert.deepEqual(r, { ok: false, code: "bad_signature" });
  // Bob's own signature over Bob's message, submitted as Alice.
  const forBob = auth.issueNonce(bob.address);
  assert.deepEqual(auth.verify(alice.address, await bob.signMessage(forBob.message)), { ok: false, code: "bad_signature" });
  // A signature over some other text, and junk.
  assert.deepEqual(auth.verify(alice.address, await alice.signMessage("hello")), { ok: false, code: "bad_signature" });
  assert.deepEqual(auth.verify(alice.address, "0x1234"), { ok: false, code: "bad_signature" });
  // A failed attempt doesn't burn the nonce: Alice can still sign in with it.
  assert.equal(auth.verify(alice.address, await alice.signMessage(message)).ok, true);
});

test("reused nonce: the same signature can't sign in twice", async () => {
  const { auth } = fixture();
  const { message } = auth.issueNonce(alice.address);
  const sig = await alice.signMessage(message);
  assert.equal(auth.verify(alice.address, sig).ok, true);
  assert.deepEqual(auth.verify(alice.address, sig), { ok: false, code: "expired_nonce" });
  // Even with a newer nonce outstanding, the old signature doesn't match it.
  auth.issueNonce(alice.address);
  assert.deepEqual(auth.verify(alice.address, sig), { ok: false, code: "bad_signature" });
});

test("expired nonce: 5 minutes is the limit", async () => {
  const { auth, clock } = fixture();
  const { message } = auth.issueNonce(alice.address);
  const sig = await alice.signMessage(message);
  clock.t += NONCE_TTL_MS;
  assert.deepEqual(auth.verify(alice.address, sig), { ok: false, code: "expired_nonce" });

  const again = auth.issueNonce(alice.address);
  clock.t += NONCE_TTL_MS - 1;
  assert.equal(auth.verify(alice.address, await alice.signMessage(again.message)).ok, true, "just inside the window");

  // Never issued at all.
  assert.deepEqual(auth.verify(bob.address, await bob.signMessage("anything")), { ok: false, code: "expired_nonce" });
});

test("nonces are capped per wallet and in total", async () => {
  const clock = { t: 1_800_000_000_000 };
  const auth = createAuth({ secret: SECRET, now: () => clock.t, maxPerAddress: 5, maxNonces: 8 });
  const first = auth.issueNonce(alice.address);
  for (let i = 0; i < 5; i++) auth.issueNonce(alice.address);
  assert.deepEqual(auth.verify(alice.address, await alice.signMessage(first.message)), { ok: false, code: "bad_signature" },
    "the sixth nonce pushed out the first");
  for (let i = 0; i < 10; i++) auth.issueNonce(ethers.Wallet.createRandom().address);
  assert.ok(auth.nonceCount() <= 8, `total capped (${auth.nonceCount()})`);
  clock.t += NONCE_TTL_MS;
  auth.prune();
  assert.equal(auth.nonceCount(), 0, "expired nonces are pruned");
});

test("tampered token: any change to the payload or MAC is refused", async () => {
  const { auth } = fixture();
  const { message } = auth.issueNonce(alice.address);
  const { token } = auth.verify(alice.address, await alice.signMessage(message));
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
  const { message } = auth.issueNonce(alice.address);
  const { token } = auth.verify(alice.address, await alice.signMessage(message));
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
    assert.throws(() => auth.verify(alice.address, "0x"));
    assert.equal(auth.verifyToken("a.b"), null);
  }
  assert.equal(createAuth({ secret: "x".repeat(32) }).configured, true);
});
