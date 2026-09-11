import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
dotenv.config();

/**
 * Close two audit blockers on QIE mainnet:
 *  1. Deploy a QiePassAdapter with an access-controlled writer (registerIdentity
 *     is now oracle/owner-only) and point the registry's qiePass at it.
 *  2. Redeploy FluenciAIAuditor against the LIVE v4 registry (the old one pointed
 *     at the v3 registry, so Protect could never pause a v4 stream), on a FRESH
 *     dedicated worker key — retiring the burned wallet 0xfe5F from every role.
 *
 * The fresh key becomes both the QIE Pass oracle and the auditor's trustedAiWorker
 * (also the dispute-settlement signer). It is written to server/.env for the VPS.
 */
const REGISTRY = "0xCc92ab9B5D973ad9598C53aC28350C34895a2e33"; // live v4
const V4 = REGISTRY;
const SERVER_ENV = "/Users/mrnetwork/Fluenci/server/.env";
const GAS = { gasLimit: 1_500_000n, gasPrice: 1_500_000_000n };
const SET_GAS = { gasLimit: 120_000n, gasPrice: 1_500_000_000n };

function upsertEnv(path: string, kv: Record<string, string>) {
  let env = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
  for (const [k, v] of Object.entries(kv)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(env)) env = env.replace(re, `${k}=${v}`);
    else env += (env.endsWith("\n") || env === "" ? "" : "\n") + `${k}=${v}\n`;
  }
  fs.writeFileSync(path, env);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer (registry owner):", deployer.address);

  // Fresh dedicated service key (QIE Pass oracle + AI worker). Never advertised as burned.
  const freshKey = ethers.Wallet.createRandom();
  console.log("fresh service key address :", freshKey.address);

  // 1) QiePassAdapter with oracle = fresh key
  console.log("\n--- Deploying QiePassAdapter ---");
  const pass = await (await ethers.getContractFactory("QiePassAdapter")).deploy(freshKey.address, GAS);
  await pass.waitForDeployment();
  const passAddr = await pass.getAddress();
  console.log("QiePassAdapter:", passAddr);

  // 2) FluenciAIAuditor against the v4 registry
  console.log("\n--- Deploying FluenciAIAuditor (v4) ---");
  const auditor = await (await ethers.getContractFactory("FluenciAIAuditor")).deploy(V4, GAS);
  await auditor.waitForDeployment();
  const auditorAddr = await auditor.getAddress();
  console.log("FluenciAIAuditor:", auditorAddr);

  const t1 = await auditor.setAiWorker(freshKey.address, SET_GAS);
  await t1.wait();
  console.log("auditor.setAiWorker ->", freshKey.address);

  // 3) Rewire the registry
  const reg = new ethers.Contract(REGISTRY, [
    "function setQiePass(address) external",
    "function setAIAuditor(address) external",
    "function qiePass() view returns (address)",
    "function aiAuditor() view returns (address)",
  ], deployer);
  const t2 = await reg.setQiePass(passAddr, SET_GAS); await t2.wait();
  const t3 = await reg.setAIAuditor(auditorAddr, SET_GAS); await t3.wait();

  // 4) Verify wiring
  console.log("\n--- Verify ---");
  const regQiePass = await reg.qiePass();
  const regAuditor = await reg.aiAuditor();
  const audReg = await auditor.fluenciRegistry();
  const audWorker = await auditor.trustedAiWorker();
  const audOwner = await auditor.owner();
  const passOracle = await pass.oracle();
  const passOwner = await pass.owner();
  const ok = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  console.log("registry.qiePass   =", regQiePass, ok(regQiePass, passAddr) ? "OK" : "MISMATCH");
  console.log("registry.aiAuditor =", regAuditor, ok(regAuditor, auditorAddr) ? "OK" : "MISMATCH");
  console.log("auditor.fluenciRegistry =", audReg, ok(audReg, V4) ? "OK (v4)" : "MISMATCH");
  console.log("auditor.trustedAiWorker =", audWorker, ok(audWorker, freshKey.address) ? "OK (fresh)" : "MISMATCH");
  console.log("auditor.owner      =", audOwner, ok(audOwner, deployer.address) ? "OK (cold owner)" : "CHECK");
  console.log("pass.oracle        =", passOracle, ok(passOracle, freshKey.address) ? "OK (fresh)" : "MISMATCH");
  console.log("pass.owner         =", passOwner, ok(passOwner, deployer.address) ? "OK (cold owner)" : "CHECK");

  // Prove the QIE Pass writer is now gated: a random sender's registerIdentity must revert.
  const rnd = ethers.Wallet.createRandom().connect(ethers.provider);
  let gated = false;
  try {
    await pass.connect(rnd).registerIdentity.staticCall("0x000000000000000000000000000000000000dEaD", true);
  } catch { gated = true; }
  console.log("registerIdentity gated for random sender:", gated ? "YES (secure)" : "NO (STILL OPEN!)");

  // 5) Write fresh key + addresses to gitignored server/.env for the VPS
  upsertEnv(SERVER_ENV, {
    AI_PRIVATE_KEY: freshKey.privateKey,
    AUDITOR_ADDRESS: auditorAddr,
    QIEPASS_CONTRACT: passAddr,
  });
  console.log("\nserver/.env updated (AI_PRIVATE_KEY rotated to fresh key, AUDITOR_ADDRESS, QIEPASS_CONTRACT). Not printed.");
  console.log("\n=== ADDRESSES ===");
  console.log("QIEPASS_CONTRACT =", passAddr);
  console.log("AUDITOR_ADDRESS  =", auditorAddr);
  console.log("AI worker/oracle =", freshKey.address, "(private key in server/.env)");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exitCode = 1; });
