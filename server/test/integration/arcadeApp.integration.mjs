// The Arcade app's own client code against the real server on a disposable chain.
//
//   1. cd contracts && npx hardhat compile
//   2. cd contracts && npx hardhat node --hostname 127.0.0.1 --port 8599      (another terminal)
//   3. node server/test/integration/arcadeApp.integration.mjs
//
// Deploys MockQUSDC + QiePassAdapter + FluenciRegistryV4, buys a real $1/month
// Arcade Pass for a fresh wallet, starts server.js from an empty scratch
// directory (so no .env is read), then does what the browser does with the
// frontend's own modules (frontend/src/dashboard/arcade/arcadeApi.js and
// snakeRound.js): signs in with one EIP-1193 personal_sign, plays scored Snake
// rounds in real time - one step per `speed` ms, key presses buffered between
// steps - and checks the server accepts exactly the turn log each round
// recorded, then reads the leaderboard. Takes about 30 seconds.
// Env: RPC_URL (default http://127.0.0.1:8599), ARTIFACTS_DIR, PORT (default 5198).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, "../../../frontend/src/dashboard/arcade");
const api = await import(pathToFileURL(path.join(FRONT, "arcadeApi.js")).href);
const ui = await import(pathToFileURL(path.join(FRONT, "snakeRound.js")).href);
const esmCore = await import(pathToFileURL(path.join(FRONT, "snakeCore.js")).href);
const { ethers } = require("ethers");
const { chooseDir } = require("../helpers/snakeBot.js");
const { parseSignInMessage } = require("../../auth.js");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8599";
const PORT = process.env.PORT || "5198";
const API = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = process.env.ARTIFACTS_DIR || path.resolve(here, "../../../contracts/artifacts/contracts");
const SERVER = path.resolve(here, "../../server.js");
const DATA_DIR = path.resolve(here, "../../data");
const ORIGIN = "https://www.fluenci.xyz";
const MONTH = 2592000;
const NAMES = ["up", "down", "left", "right"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const artifact = (n) => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${n}.sol`, `${n}.json`), "utf8"));
let passed = 0;
let failed = 0;
function expect(name, cond, got) {
  if (cond) passed++; else failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  got: ${JSON.stringify(got)}`}`);
}

/** The connected wallet as the browser sees it; personal_sign as useFluenciV4.signMessage sends it. */
const signed = []; // every text a wallet was asked to sign
const signerFor = (wallet, account) => async (message) => {
  const provider = {
    async request({ method, params }) {
      if (method !== "personal_sign" || !api.sameAddress(params[1], wallet.address)) throw new Error("unexpected wallet request");
      signed.push(ethers.toUtf8String(params[0]));
      return wallet.signMessage(ethers.getBytes(params[0]));
    },
  };
  return provider.request({ method: "personal_sign", params: [ethers.hexlify(ethers.toUtf8Bytes(message)), account] });
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A round played at game speed, the way SnakeGame.jsx's loop plays it. */
async function playInRealTime(seed, rngSeed, stopPressingAt) {
  const rand = mulberry(rngSeed);
  const round = ui.newRound(seed);
  const started = Date.now();
  while (round.game.alive) {
    if (round.game.steps < stopPressingAt) {
      const presses = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 3);
      for (let i = 0; i < presses; i++) {
        ui.queueTurn(round, rand() < 0.85 ? chooseDir(esmCore, round.game) : NAMES[Math.floor(rand() * 4)]);
      }
    }
    await sleep(round.game.speed); // the next step waits the current speed, as the rAF loop does
    ui.advance(round);
  }
  return { round, durationMs: Date.now() - started };
}

const dataExisted = fs.existsSync(DATA_DIR);
const boardExisted = fs.existsSync(path.join(DATA_DIR, "arcade.json"));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-arcade-app-"));
let srv = null;
let log = "";
try {
  if (boardExisted) throw new Error("server/data/arcade.json already exists; refusing to overwrite it");
  // ---- chain setup ----------------------------------------------------------
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
  console.log(`chain ${chainId}: MockQUSDC ${tokenAddr}, FluenciRegistryV4 ${registryAddr}`);

  const merchant = ethers.Wallet.createRandom().address;
  const player = ethers.Wallet.createRandom().connect(provider);
  const stranger = ethers.Wallet.createRandom().connect(provider);
  let ownerNonce = await provider.getTransactionCount(await owner.getAddress());
  await (await owner.sendTransaction({ to: player.address, value: ethers.parseEther("1"), nonce: ownerNonce++ })).wait();
  await (await token.connect(owner).mint(player.address, 10_000_000n, { nonce: ownerNonce++ })).wait();
  // The Arcade's own purchase: a $2/30-day cap, an approval, a $1/month subscription.
  await (await registry.connect(player).setSpendCap(merchant, 2_000_000n, MONTH)).wait();
  await (await token.connect(player).approve(registryAddr, 12_000_000n)).wait();
  await (await registry.connect(player).createSubscription(merchant, tokenAddr, 1_000_000n, MONTH, 0, 0)).wait();

  // ---- server from a scratch dir --------------------------------------------------
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
  expect("server started on the local chain", /Connected to blockchain\. Chain ID: 31337/.test(log), log.slice(-400));

  // ---- what the app does -----------------------------------------------------------
  const before = await api.fetchLeaderboard({ apiBase: API });
  expect("leaderboard (signed out): this week, nobody yet, no 'you'", before.ok && /^\d{4}-W\d{2}$/.test(before.week) && before.entries.length === 0 && before.you === null, before);

  // Injected wallets report the account in lowercase.
  const account = player.address.toLowerCase();
  const session = await api.signInToArcade({ apiBase: API, address: account, sign: signerFor(player, account) });
  expect("sign-in: one personal_sign from the app gives a 12-hour token for the checksummed wallet",
    session.ok && session.address === player.address && Date.parse(session.expiresAt) - Date.now() > 11 * 3600 * 1000, session);
  const siwe = signed.length === 1 ? parseSignInMessage(signed[0]) : null;
  expect("the wallet was asked to sign an EIP-4361 message for www.fluenci.xyz, chain 1990, this wallet",
    siwe && siwe.domain === "www.fluenci.xyz" && siwe.uri === "https://www.fluenci.xyz" && siwe.version === "1" && siwe.chainId === 1990 &&
      siwe.address === player.address, signed);

  const pass = await api.requestJson(API, "/arcade/pass", { token: session.token });
  expect("the server sees the pass on chain for the signed-in wallet", pass.status === 200 && pass.data?.valid === true, pass);

  // ArcadeChat's request, as it sends it: Bearer token, from Fluenci's origin.
  const chat = (tok) => fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify({ messages: [{ role: "user", content: "What is the Arcade Pass?" }] }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const c1 = await chat(session.token);
  expect("chat with the token passes the gate (then 503: no OpenAI key in this test)", c1.status === 503 && c1.body?.error === "OpenAI not configured", c1);
  const c0 = await chat(null);
  expect("chat without a token (the v1 chat) is 401, which v1 turns into the Arcade Pass message", c0.status === 401 && c0.body?.code === "unauthorized", c0);

  // Four scored rounds at once, each played at game speed.
  const plays = await Promise.all([40, 60, 80, 100].map(async (stopAt, i) => {
    const start = await api.startSnakeRound({ apiBase: API, token: session.token });
    if (!start.ok) return { start };
    const { round, durationMs } = await playInRealTime(start.seed, 500 + i, stopAt);
    const done = await api.finishSnakeRound({ apiBase: API, token: session.token, ticket: start.ticket, inputs: round.inputs, score: round.game.score, durationMs });
    return { start, round, durationMs, done };
  }));
  let best = 0;
  for (const [i, p] of plays.entries()) {
    const ok = p.start.ok && p.done?.ok === true && p.done.score === p.round.game.score;
    if (ok) best = Math.max(best, p.round.game.score);
    expect(`round ${i + 1}: seed ${p.start.seed}, ${p.round?.inputs.length} turns, ${p.round?.game.steps} steps, score ${p.round?.game.score} in ${p.durationMs} ms (minimum ${p.round?.game.timeMs}) - accepted as played`,
      ok, { start: p.start, done: p.done });
  }
  const finals = plays.map((p) => p.done).filter((d) => d?.ok);
  // One player: #1 once anything is listed; nothing listed (rank null) while the best is still 0.
  expect("each answer carries this week's best and rank",
    finals.length === 4 && finals.every((d) => /^\d{4}-W\d{2}$/.test(d.week) && d.best >= d.score && d.best <= best && d.rank === (d.best > 0 ? 1 : null)), finals);

  const board = await api.fetchLeaderboard({ apiBase: API, token: session.token });
  expect("leaderboard (signed in): the player's best at #1, and 'you'",
    board.ok && board.entries.length === 1 && board.entries[0].address === player.address && board.entries[0].score === best &&
      board.you?.best === best && board.you?.rank === 1, board);
  const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "arcade.json"), "utf8"));
  expect("the score is in server/data/arcade.json", saved.weeks?.[board.week]?.[player.address.toLowerCase()]?.score === best, saved);

  const other = await api.signInToArcade({ apiBase: API, address: stranger.address, sign: signerFor(stranger, stranger.address) });
  const noPass = await api.startSnakeRound({ apiBase: API, token: other.token });
  expect("a wallet without a pass gets no ticket (the app plays that round unscored)", other.ok && !noPass.ok && noPass.code === "no_pass" && /valid Arcade Pass/.test(noPass.message), noPass);

  const dead = await api.startSnakeRound({ apiBase: API, token: `${session.token}x` });
  expect("a broken token is 401 (the app signs out)", !dead.ok && dead.unauthorized === true, dead);
  const staleBoard = await api.fetchLeaderboard({ apiBase: API, token: `${session.token}x` });
  expect("the leaderboard with a broken token is 401 too (the app signs out, never shows a stale 'you')",
    !staleBoard.ok && staleBoard.status === 401 && staleBoard.unauthorized === true, staleBoard);

  expect("server stayed up with no unhandled errors", srv.exitCode === null && !/Unhandled|UnhandledPromiseRejection|TypeError/.test(log), log.slice(-800));
} catch (err) {
  failed++;
  console.log("ERROR", err);
  if (log) console.log(log.slice(-1500));
} finally {
  if (srv) srv.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
  // Only what this run created: the leaderboard file, and the data dir if it wasn't there before.
  if (!boardExisted) {
    fs.rmSync(path.join(DATA_DIR, "arcade.json"), { force: true });
    fs.rmSync(path.join(DATA_DIR, "arcade.json.tmp"), { force: true });
  }
  if (!dataExisted && fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length === 0) fs.rmdirSync(DATA_DIR);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
