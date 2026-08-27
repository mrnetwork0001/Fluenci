import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploys the v4 stack.
 *
 *   local:   npx hardhat node                                    (separate terminal)
 *            npx hardhat run scripts/deployV4.ts --network localhost
 *   mainnet: npx hardhat run scripts/deployV4.ts --network qieMainnet
 *
 * Mainnet requires TREASURY_ADDRESS and REPUTATION_SIGNER in .env - see
 * .env.example. The script refuses to guess either, because both are baked in
 * at construction and every claim before you change them uses what was set.
 */

const MAINNET_DEFAULTS = {
  qiePass: "0x0766Ff824376CEf38CFa5C155A51E90578096e38",
  aiAuditor: "0xF38d9458d14d916B60026693a76FBe7cDEf651Fa",
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
};

function requireAddress(name: string, value: string | undefined): string {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(
      `${name} is missing or not a valid address.\n` +
      `Set it in contracts/.env - see contracts/.env.example for what each value means.`
    );
  }
  return ethers.getAddress(value);
}

async function main() {
  const [deployer, , merchant] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const isLocal = net.chainId === 31337n;

  console.log(`network   : ${net.name} (${net.chainId})`);
  console.log(`deployer  : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`gas       : ${ethers.formatEther(balance)} QIE`);
  if (!isLocal && balance === 0n) {
    throw new Error("Deployer has no QIE for gas. Fund it before deploying.");
  }

  let qusdc = MAINNET_DEFAULTS.qusdc;
  let qiePass = process.env.QIE_PASS_ADDRESS || MAINNET_DEFAULTS.qiePass;
  let treasury: string;
  let reputationSigner: string;

  if (isLocal) {
    const token = await (await ethers.getContractFactory("MockQUSDC")).deploy();
    const pass = await (await ethers.getContractFactory("MockQiePass")).deploy();
    qusdc = await token.getAddress();
    qiePass = await pass.getAddress();
    await pass.registerIdentity(deployer.address, true);
    await pass.registerIdentity(merchant.address, true);
    treasury = deployer.address;
    reputationSigner = deployer.address;
    console.log(`MockQUSDC : ${qusdc}`);
    console.log(`MockPass  : ${qiePass}`);
  } else {
    // Mainnet: never guess these.
    treasury = requireAddress("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS);
    reputationSigner = requireAddress("REPUTATION_SIGNER", process.env.REPUTATION_SIGNER);
    qiePass = requireAddress("QIE_PASS_ADDRESS", qiePass);
    console.log(`treasury  : ${treasury}`);
    console.log(`qiePass   : ${qiePass}`);
    console.log(`rep signer: ${reputationSigner}`);
  }

  const registry = await (await ethers.getContractFactory("FluenciRegistryV4"))
    .deploy(qiePass, treasury);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  const attestor = await (await ethers.getContractFactory("FluenciReputationAttestor"))
    .deploy(reputationSigner);
  await attestor.waitForDeployment();
  const attestorAddr = await attestor.getAddress();

  await (await registry.setQieReputation(attestorAddr)).wait();
  console.log("\nwired     : registry.setQieReputation(attestor)");

  const auditor = process.env.AI_AUDITOR_ADDRESS || (isLocal ? "" : MAINNET_DEFAULTS.aiAuditor);
  if (auditor && ethers.isAddress(auditor)) {
    await (await registry.setAIAuditor(ethers.getAddress(auditor))).wait();
    console.log(`wired     : registry.setAIAuditor(${auditor})`);
  } else {
    console.log("skipped   : setAIAuditor - Protect pauses and disputes are inactive until set");
  }

  const modelVersion = process.env.REQUIRED_MODEL_VERSION;
  if (modelVersion) {
    await (await attestor.setRequiredModelVersion(modelVersion)).wait();
    console.log(`wired     : attestor.setRequiredModelVersion("${modelVersion}")`);
  }

  console.log(`\nFluenciRegistryV4         : ${registryAddr}`);
  console.log(`FluenciReputationAttestor : ${attestorAddr}`);

  if (isLocal) {
    const token = await ethers.getContractAt("MockQUSDC", qusdc);
    await (await token.mint(deployer.address, 5_000_000_000n)).wait();
    await (await token.approve(registryAddr, ethers.MaxUint256)).wait();
    await (await registry.setSpendCap(merchant.address, 20_000_000n, 2_592_000n)).wait();
    await (await registry.createSubscription(merchant.address, qusdc, 20_000_000n, 2_592_000n, 0, 0)).wait();
    console.log(`\nseeded    : $20/month to ${merchant.address}, capped at $20/month`);
  }

  console.log(`\n--- next steps -----------------------------------------------`);
  console.log(`1. frontend env:`);
  console.log(`   VITE_REGISTRY_V4_ADDRESS=${registryAddr}`);
  console.log(`   VITE_REPUTATION_ATTESTOR_ADDRESS=${attestorAddr}`);
  if (isLocal) console.log(`   VITE_V4_RPC_URL=http://127.0.0.1:8545`);
  if (!isLocal) {
    const block = await ethers.provider.getBlockNumber();
    console.log(`2. server/.env:`);
    console.log(`   REGISTRY_ADDRESS=${registryAddr}`);
    console.log(`   START_BLOCK=${block}      <- move BOTH together, or the indexer rescans`);
    console.log(`3. verify:  npx hardhat verify --network qieMainnet ${registryAddr} "${qiePass}" "${treasury}"`);
    console.log(`            npx hardhat verify --network qieMainnet ${attestorAddr} "${reputationSigner}"`);
    console.log(`4. set V3_WRITES_FROZEN = false in frontend/src/config.js`);
    console.log(`5. transfer ownership off the deployer key when you are ready:`);
    console.log(`   registry.transferOwnership(<multisig>) then acceptOwnership() from it`);
  }
}

main().catch((e) => { console.error("\n" + (e.message || e)); process.exitCode = 1; });
