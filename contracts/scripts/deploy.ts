import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  // 1. Deploy Mock Qie Pass
  const MockQiePass = await ethers.getContractFactory("MockQiePass");
  const qiePass = await MockQiePass.deploy();
  await qiePass.waitForDeployment();
  const qiePassAddress = await qiePass.getAddress();
  console.log(`MockQiePass deployed to: ${qiePassAddress}`);

  // 2. Deploy Mock Stablecoin (qUSDC)
  const MockQUSDC = await ethers.getContractFactory("MockQUSDC");
  const qusdc = await MockQUSDC.deploy();
  await qusdc.waitForDeployment();
  const qusdcAddress = await qusdc.getAddress();
  console.log(`MockQUSDC deployed to: ${qusdcAddress}`);

  // 3. Deploy Mock WETH
  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  const wethAddress = await weth.getAddress();
  console.log(`MockWETH deployed to: ${wethAddress}`);

  // 4. Deploy Registry (Constructor only takes QiePass)
  const FluenciRegistry = await ethers.getContractFactory("FluenciRegistry");
  const registry = await FluenciRegistry.deploy(qiePassAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`FluenciRegistry deployed to: ${registryAddress}`);

  // 5. Deploy AI Auditor
  const FluenciAIAuditor = await ethers.getContractFactory("FluenciAIAuditor");
  const auditor = await FluenciAIAuditor.deploy(registryAddress);
  await auditor.waitForDeployment();
  const auditorAddress = await auditor.getAddress();
  console.log(`FluenciAIAuditor deployed to: ${auditorAddress}`);

  // 6. Connect Registry to AI Auditor
  const setAuditorTx = await registry.setAIAuditor(auditorAddress);
  await setAuditorTx.wait();
  console.log("Registered AI Auditor on FluenciRegistry");

  // 7. Set AI worker address
  // AI_PRIVATE_KEY from server env resolves to: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
  const aiWorkerAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const setWorkerTx = await auditor.setAiWorker(aiWorkerAddress);
  await setWorkerTx.wait();
  console.log(`Registered AI worker ${aiWorkerAddress} on FluenciAIAuditor`);

  // 8. Deploy MockQieDex
  const MockQieDex = await ethers.getContractFactory("MockQieDex");
  const dex = await MockQieDex.deploy(qusdcAddress, wethAddress);
  await dex.waitForDeployment();
  const dexAddress = await dex.getAddress();
  console.log(`MockQieDex deployed to: ${dexAddress}`);

  // 9. Deploy MockQieDomain resolver
  const MockQieDomain = await ethers.getContractFactory("MockQieDomain");
  const qieDomain = await MockQieDomain.deploy();
  await qieDomain.waitForDeployment();
  const qieDomainAddress = await qieDomain.getAddress();
  console.log(`MockQieDomain deployed to: ${qieDomainAddress}`);

  // Pre-register some mock domains for testing
  const merchantAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Hardhat Account #1
  const doodleMerchant = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Hardhat Account #2
  
  await qieDomain.registerDomain("netflix.qie", merchantAddress);
  await qieDomain.registerDomain("qiedoodle.qie", doodleMerchant);
  console.log("Pre-registered test domains: netflix.qie -> merchant, qiedoodle.qie -> doodle game merchant");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
