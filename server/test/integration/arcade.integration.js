// End-to-end Arcade Stage 2 check on a disposable local chain.
//
//   1. cd contracts && npx hardhat compile
//   2. cd contracts && npx hardhat node --hostname 127.0.0.1 --port 8599      (another terminal)
//   3. node server/test/integration/arcade.integration.js
//
// Deploys MockQUSDC + QiePassAdapter + FluenciRegistryV4, opens real $1/month
// Arcade subscriptions from fresh test wallets, starts server.js from an empty
// scratch directory (so no .env is read) with ARCADE_MERCHANT and
// ARCADE_STABLECOINS pointing at the local contracts and no OPENAI_API_KEY, and
// checks sign-in, the on-chain pass, the /api/chat gate and Snake scores.
// Takes about 90 seconds: it waits out the pass cache on purpose.
// Env: RPC_URL (default http://127.0.0.1:8599), ARTIFACTS_DIR, PORT (default 5197).
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const core = require("../../arcade/snakeCore");
const { parseSignInMessage } = require("../../auth");
const { playBot } = require("../helpers/snakeBot");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8599";
const PORT = process.env.PORT || "5197";
const API = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = process.env.ARTIFACTS_DIR || path.resolve(__dirname, "../../../contracts/artifacts/contracts");
const SERVER = path.resolve(__dirname, "../../server.js");
const DATA_DIR = path.resolve(__dirname, "../../data");
const ORIGIN = "https://www.fluenci.xyz";
const MONTH = 2592000;
const PASS_CACHE_MS = 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const artifact = (n) => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${n}.sol`, `${n}.json`), "utf8"));
let passed = 0;
let failed = 0;
function expect(name, cond, got) {
  if (cond) passed++; else failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  got: ${JSON.stringify(got)}`}`);
}

async function call(method, p, { token, body, origin, ip } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  // The server trusts the last X-Forwarded-For entry from a loopback peer (its nginx), so a
  // test can stand in for another client IP without using up 127.0.0.1's limits.
  if (ip) headers["X-Forwarded-For"] = ip;
  const r = await fetch(API + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
}

async function signIn(wallet) {
  const n = await call("POST", "/auth/nonce", { body: { address: wallet.address } });
  const { message, nonce } = n.body;
  const sig = await wallet.signMessage(message);
  const v = await call("POST", "/auth/verify", { body: { address: wallet.address, nonce, message, signature: sig } });
  if (v.status !== 200) throw new Error(`sign-in failed for ${wallet.address}: ${JSON.stringify(v.body)}`);
  return v.body.token;
}

(async () => {
  const dataExisted = fs.existsSync(DATA_DIR);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-arcade-it-"));
  let srv = null;
  let log = "";
  try {
    // ---- chain setup ----------------------------------------------------------
    // No request cache: back-to-back sends from one wallet must see fresh nonces.
    const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
    const chainId = Number((await provider.getNetwork()).chainId);
    if (chainId === 1990) throw new Error("Refusing to run against QIE mainnet");
    const owner = await provider.getSigner(0);
    const oracle = await provider.getSigner(1);
    const deploy = async (name, ...args) => {
      const a = artifact(name);
      const c = await new ethers.ContractFactory(a.abi, a.bytecode, owner).deploy(...args);
      await c.waitForDeployment();
      return c;
    };
    const token = await deploy("MockQUSDC");
    const adapter = await deploy("QiePassAdapter", await oracle.getAddress());
    const registry = await deploy("FluenciRegistryV4", await adapter.getAddress(), await owner.getAddress());
    const tokenAddr = await token.getAddress();
    const registryAddr = await registry.getAddress();
    console.log(`chain ${chainId}: MockQUSDC ${tokenAddr}, QiePassAdapter ${await adapter.getAddress()}, FluenciRegistryV4 ${registryAddr}`);

    const merchant = ethers.Wallet.createRandom().address;
    const wallet = () => ethers.Wallet.createRandom().connect(provider);
    const [alice, bob, carol, dave, stranger, hoarder] = [wallet(), wallet(), wallet(), wallet(), wallet(), wallet()];
    let ownerNonce = await provider.getTransactionCount(await owner.getAddress());
    for (const w of [alice, bob, carol, dave]) {
      await (await owner.sendTransaction({ to: w.address, value: ethers.parseEther("1"), nonce: ownerNonce++ })).wait();
      await (await token.connect(owner).mint(w.address, 10_000_000n, { nonce: ownerNonce++ })).wait();
    }
    // F2: a wallet holding 55 subscriptions to some other merchant (they cost nothing to open).
    await (await owner.sendTransaction({ to: hoarder.address, value: ethers.parseEther("1"), nonce: ownerNonce++ })).wait();
    const elsewhere = ethers.Wallet.createRandom().address;
    let hoarderNonce = 0;
    const opened = [];
    for (let i = 0; i < 55; i++) {
      opened.push(await registry.connect(hoarder).createSubscription(elsewhere, tokenAddr, 1n, MONTH, 0, 0, { nonce: hoarderNonce++ }));
    }
    await Promise.all(opened.map((tx) => tx.wait()));

    /** The Arcade's own flow: cap at $2/30 days, approve, then a $1/month subscription in qUSDC. */
    async function buyPass(w) {
      const reg = registry.connect(w);
      await (await reg.setSpendCap(merchant, 2_000_000n, MONTH)).wait();
      await (await token.connect(w).approve(registryAddr, 12_000_000n)).wait();
      await (await reg.createSubscription(merchant, tokenAddr, 1_000_000n, MONTH, 0, 0)).wait();
      const ids = await registry.getSubscriberSubscriptions(w.address);
      return ids[ids.length - 1];
    }
    const subAlice = await buyPass(alice);
    const subBob = await buyPass(bob);
    await buyPass(carol);
    const sub = await registry.getSubscription(subAlice);
    expect("a real $1/month subscription exists on chain", sub.active && sub.amountPerPeriod === 1_000_000n && sub.merchant === merchant, null);

    // ---- server from a scratch dir ------------------------------------------------
    const env = {
      PATH: process.env.PATH,
      PORT,
      RPC_URL: RPC,
      REGISTRY_ADDRESS: registryAddr,
      START_BLOCK: "0",
      SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
      ARCADE_MERCHANT: merchant,
      ARCADE_STABLECOINS: tokenAddr,
    };
    srv = spawn(process.execPath, [SERVER], { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"] });
    srv.stdout.on("data", (d) => (log += d));
    srv.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 80 && !/Connected to blockchain\. Chain ID: \d+/.test(log); i++) await sleep(250);
    expect("server started and read the local chain id", /Connected to blockchain\. Chain ID: 31337/.test(log), log.slice(-400));
    expect("boot log warns that ARCADE_STABLECOINS is test-only", /ARCADE_STABLECOINS is set/.test(log), null);
    expect("boot log never prints the session secret", !log.includes(env.SESSION_SECRET), null);

    // ---- CORS -----------------------------------------------------------------------
    const pre = await fetch(`${API}/arcade/pass`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    expect("CORS: Fluenci's origin may call /arcade/pass with an Authorization header",
      pre.headers.get("access-control-allow-origin") === ORIGIN && /authorization/i.test(pre.headers.get("access-control-allow-headers") || ""),
      Object.fromEntries(pre.headers));
    const evil = await call("POST", "/auth/nonce", { origin: "https://evil.example", body: { address: alice.address } });
    expect("CORS: another origin gets no allow-origin header on /auth/nonce", !evil.headers.get("access-control-allow-origin"), Object.fromEntries(evil.headers));
    const chatPre = await fetch(`${API}/api/chat`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
    expect("CORS: /api/chat preflight allows Authorization", /authorization/i.test(chatPre.headers.get("access-control-allow-headers") || ""), Object.fromEntries(chatPre.headers));
    const open = await call("GET", "/status", { origin: "https://evil.example" });
    expect("CORS: other routes stay open (/status)", open.headers.get("access-control-allow-origin") === "*", Object.fromEntries(open.headers));

    // ---- sign-in (F3, F4) --------------------------------------------------------------
    const erin = ethers.Wallet.createRandom(); // signs in only; no chain state needed
    const n1 = await call("POST", "/auth/nonce", { body: { address: erin.address } });
    const parsed = parseSignInMessage(n1.body.message);
    expect("sign-in message is EIP-4361 for www.fluenci.xyz (URI, Version 1, Chain ID 1990, this nonce)",
      parsed && parsed.domain === "www.fluenci.xyz" && parsed.uri === "https://www.fluenci.xyz" && parsed.version === "1" &&
        parsed.chainId === 1990 && parsed.address === erin.address && parsed.nonce === n1.body.nonce, n1.body);
    // While erin's wallet prompt is open, someone else asks for nonces for her address.
    const flood = [];
    for (let i = 0; i < 6; i++) flood.push((await call("POST", "/auth/nonce", { body: { address: erin.address }, ip: "198.51.100.7" })).status);
    expect("nonce requests for erin from elsewhere: never refused, never evicting hers", flood.every((st) => st === 200), flood);
    const v1 = await call("POST", "/auth/verify", { body: { address: erin.address, nonce: n1.body.nonce, message: n1.body.message, signature: await erin.signMessage(n1.body.message) } });
    expect("erin's pending sign-in still completes with the nonce she was given", v1.status === 200 && v1.body.address === erin.address, v1.body);
    const noNonce = await call("POST", "/auth/verify", { body: { address: erin.address, signature: await erin.signMessage(n1.body.message) } });
    expect("verify without a nonce or message is 400 bad_request", noNonce.status === 400 && noNonce.body.code === "bad_request", noNonce.body);

    // ---- the on-chain pass ---------------------------------------------------------------
    const tAlice = await signIn(alice);
    const tStranger = await signIn(stranger);
    const pA = await call("GET", "/arcade/pass", { token: tAlice });
    expect("/arcade/pass: valid for the subscriber", pA.status === 200 && pA.body.valid === true && pA.body.reason === "ok", pA.body);
    const pS = await call("GET", "/arcade/pass", { token: tStranger });
    expect("/arcade/pass: invalid for a stranger (no-subscription)", pS.body.valid === false && pS.body.reason === "no-subscription", pS.body);
    const pNone = await call("GET", "/arcade/pass");
    expect("/arcade/pass: 401 unauthorized without a token", pNone.status === 401 && pNone.body.code === "unauthorized", pNone);

    // F2: 55 unseen subscriptions are read 50 per check; until then the answer is "unavailable".
    const tHoarder = await signIn(hoarder);
    const pH1 = await call("GET", "/arcade/pass", { token: tHoarder });
    expect("/arcade/pass: 55 subscriptions the server hasn't seen - the first check reads 50 and answers unavailable",
      pH1.body.valid === false && pH1.body.reason === "unavailable" && /pass check for 0x[0-9a-fA-F]{40}: 5 of 55 subscriptions not read yet/.test(log), { body: pH1.body, log: log.slice(-300) });
    const pH2 = await call("GET", "/arcade/pass", { token: tHoarder });
    expect("/arcade/pass: the next check reads the other 5 and answers no-subscription", pH2.body.valid === false && pH2.body.reason === "no-subscription", pH2.body);

    // ---- /api/chat gate ---------------------------------------------------------------
    const chatBody = { messages: [{ role: "user", content: "What is the Arcade Pass?" }] };
    const c0 = await call("POST", "/api/chat", { body: chatBody, origin: ORIGIN });
    expect("/api/chat: 401 unauthorized without a token", c0.status === 401 && c0.body.code === "unauthorized", c0);
    const cS = await call("POST", "/api/chat", { token: tStranger, body: chatBody, origin: ORIGIN });
    expect("/api/chat: 403 no_pass for a stranger", cS.status === 403 && cS.body.code === "no_pass" && cS.body.reason === "no-subscription", cS.body);
    const cA = await call("POST", "/api/chat", { token: tAlice, body: chatBody, origin: ORIGIN });
    expect("/api/chat: the pass holder gets through the gate to the OpenAI branch (503 not_configured, OpenAI not configured)",
      cA.status === 503 && cA.body.code === "not_configured" && cA.body.error === "OpenAI not configured", cA.body);
    const cBad = await call("POST", "/api/chat", { token: tAlice, body: { messages: "nope" }, origin: ORIGIN });
    expect("/api/chat: existing bad_request still applies after the gate", cBad.status === 400 && cBad.body.code === "bad_request", cBad.body);

    // ---- prime the cache for the lapsing passes, then break them on chain ----------
    const tBob = await signIn(bob);
    const tCarol = await signIn(carol);
    const tDave = await signIn(dave);
    const before = await Promise.all([tBob, tCarol].map((t) => call("GET", "/arcade/pass", { token: t })));
    expect("/arcade/pass: bob and carol valid before anything changes", before.every((r) => r.body.valid === true), before.map((r) => r.body));
    const pD = await call("GET", "/arcade/pass", { token: tDave });
    expect("/arcade/pass: dave has no pass yet", pD.body.reason === "no-subscription", pD.body);
    await (await registry.connect(bob).terminateStream(subBob)).wait();
    await (await token.connect(carol).approve(registryAddr, 0n)).wait();
    const brokeAt = Date.now();
    await buyPass(dave);
    const cached = await call("GET", "/arcade/pass", { token: tBob });
    expect("/arcade/pass: a valid result is cached (still valid right after terminateStream)", cached.body.valid === true, cached.body);

    // ---- Snake, end to end (while the cache runs out) -------------------------------
    const sS = await call("POST", "/arcade/snake/start", { token: tStranger });
    expect("snake start: 403 no_pass for a stranger", sS.status === 403 && sS.body.code === "no_pass", sS.body);
    const quick = await call("POST", "/arcade/snake/start", { token: tAlice });
    const quickGame = playBot(core, quick.body.seed, { stopAtScore: 20 });
    const fast = await call("POST", "/arcade/snake/finish", { token: tAlice, body: { ticket: quick.body.ticket, inputs: quickGame.inputs, score: quickGame.state.score, durationMs: 1 } });
    expect("snake finish: a time-compressed game is too_fast", fast.status === 400 && fast.body.accepted === false && fast.body.code === "too_fast", fast.body);
    const reuse = await call("POST", "/arcade/snake/finish", { token: tAlice, body: { ticket: quick.body.ticket, inputs: quickGame.inputs, score: quickGame.state.score } });
    expect("snake finish: the ticket can't be used again", reuse.body.code === "bad_ticket", reuse.body);

    const s = await call("POST", "/arcade/snake/start", { token: tAlice });
    expect("snake start: ticket + seed + issuedAt for the pass holder", s.status === 200 && /^[0-9a-f]{32}$/.test(s.body.ticket) && Number.isInteger(s.body.seed) && !Number.isNaN(Date.parse(s.body.issuedAt)), s.body);
    const game = playBot(core, s.body.seed, { stopAtScore: 30 });
    const stolen = await call("POST", "/arcade/snake/finish", { token: tStranger, body: { ticket: s.body.ticket, inputs: game.inputs, score: game.state.score } });
    expect("snake finish: another wallet can't use the ticket", stolen.body.code === "bad_ticket", stolen.body);
    console.log(`      playing seed ${s.body.seed} at game speed: ${game.state.steps} steps, score ${game.state.score}, ${game.state.timeMs} ms`);
    await sleep(game.state.timeMs + 250);
    const lie = { ticket: s.body.ticket, inputs: game.inputs, score: game.state.score + 10, durationMs: game.state.timeMs };
    const liar = await call("POST", "/arcade/snake/finish", { token: tAlice, body: lie });
    expect("snake finish: an altered score is a mismatch", liar.body.code === "mismatch", liar.body);

    const s2 = await call("POST", "/arcade/snake/start", { token: tAlice });
    const g2 = playBot(core, s2.body.seed, { stopAtScore: 30 });
    await sleep(g2.state.timeMs + 250);
    const done = await call("POST", "/arcade/snake/finish", { token: tAlice, body: { ticket: s2.body.ticket, inputs: g2.inputs, score: g2.state.score, durationMs: g2.state.timeMs } });
    expect("snake finish: a real game is accepted with best, rank and week",
      done.status === 200 && done.body.accepted === true && done.body.score === g2.state.score && done.body.best === g2.state.score && done.body.rank === 1 && /^\d{4}-W\d{2}$/.test(done.body.week), done.body);
    const board = await call("GET", "/arcade/leaderboard");
    expect("leaderboard: public view lists the score, no 'you'",
      board.body.entries.length === 1 && board.body.entries[0].address === alice.address && board.body.entries[0].score === g2.state.score && board.body.you === null, board.body);
    const mine = await call("GET", "/arcade/leaderboard", { token: tAlice });
    expect("leaderboard: with a token, the caller's own best and rank", mine.body.you && mine.body.you.best === g2.state.score && mine.body.you.rank === 1, mine.body);
    const stale = await call("GET", "/arcade/leaderboard", { token: `${tAlice}x` });
    expect("leaderboard: a token that can't be accepted is 401 unauthorized, not an answer without 'you'", stale.status === 401 && stale.body.code === "unauthorized" && !("you" in stale.body), stale.body);
    const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "arcade.json"), "utf8"));
    expect("leaderboard: persisted to server/data/arcade.json", saved.weeks[done.body.week]?.[alice.address.toLowerCase()]?.score === g2.state.score, saved);

    // ---- after the cache: terminateStream, revoked approval, a new pass ------------
    const wait = PASS_CACHE_MS + 1500 - (Date.now() - brokeAt);
    if (wait > 0) { console.log(`      waiting ${Math.round(wait / 1000)} s for the pass cache to expire`); await sleep(wait); }
    const pB = await call("GET", "/arcade/pass", { token: tBob });
    expect("/arcade/pass: invalid after terminateStream (cancelled)", pB.body.valid === false && pB.body.reason === "cancelled", pB.body);
    const pC = await call("GET", "/arcade/pass", { token: tCarol });
    expect("/arcade/pass: invalid after revoking the approval (insufficient-allowance)", pC.body.valid === false && pC.body.reason === "insufficient-allowance", pC.body);
    const pD2 = await call("GET", "/arcade/pass", { token: tDave });
    expect("/arcade/pass: a pass bought after a 'no pass' answer is seen once the short negative cache runs out", pD2.body.valid === true, pD2.body);
    const cB = await call("POST", "/api/chat", { token: tBob, body: chatBody, origin: ORIGIN });
    expect("/api/chat: 403 no_pass once the pass is cancelled", cB.status === 403 && cB.body.code === "no_pass" && cB.body.reason === "cancelled", cB.body);
    const sB = await call("POST", "/arcade/snake/start", { token: tBob });
    expect("snake start: 403 no_pass once the pass is cancelled", sB.status === 403 && sB.body.code === "no_pass", sB.body);

    // F1: snake/start has a per-IP limit (60 per 10 minutes) in front of the sign-in check.
    const burst = [];
    for (let i = 0; i < 62; i++) burst.push(await call("POST", "/arcade/snake/start", { token: "junk.token", ip: "203.0.113.9" }));
    expect("snake start: 60 requests per IP per 10 minutes, then 429 rate_ip (before the sign-in check)",
      burst.slice(0, 60).every((r) => r.status === 401) && burst.slice(60).every((r) => r.status === 429 && r.body.code === "rate_ip"),
      burst.map((r) => r.status).join(","));
    const otherIp = await call("POST", "/arcade/snake/start", { token: tAlice });
    expect("snake start: other clients keep their own allowance", otherIp.status === 200, otherIp.body);

    expect("server stayed up with no unhandled errors", srv.exitCode === null && !/Unhandled|UnhandledPromiseRejection|TypeError/.test(log), log.slice(-800));
  } catch (err) {
    failed++;
    console.log("ERROR", err);
    if (log) console.log(log.slice(-1500));
  } finally {
    if (srv) srv.kill();
    fs.rmSync(scratch, { recursive: true, force: true });
    // Only what this run created: the leaderboard file, and the data dir if it wasn't there before.
    fs.rmSync(path.join(DATA_DIR, "arcade.json"), { force: true });
    fs.rmSync(path.join(DATA_DIR, "arcade.json.tmp"), { force: true });
    if (!dataExisted && fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length === 0) fs.rmdirSync(DATA_DIR);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
