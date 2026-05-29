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

  // 2. Deploy Mock Stablecoin (qUSD)
  const MockQUSD = await ethers.getContractFactory("MockQUSD");
  const qusd = await MockQUSD.deploy();
  await qusd.waitForDeployment();
  const qusdAddress = await qusd.getAddress();
  console.log(`MockQUSD deployed to: ${qusdAddress}`);

  // 3. Deploy Registry
  const QieFlowRegistry = await ethers.getContractFactory("QieFlowRegistry");
  const registry = await QieFlowRegistry.deploy(qiePassAddress, qusdAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`QieFlowRegistry deployed to: ${registryAddress}`);

  // 4. Deploy AI Auditor
  const QieFlowAIAuditor = await ethers.getContractFactory("QieFlowAIAuditor");
  const auditor = await QieFlowAIAuditor.deploy(registryAddress);
  await auditor.waitForDeployment();
  const auditorAddress = await auditor.getAddress();
  console.log(`QieFlowAIAuditor deployed to: ${auditorAddress}`);

  // 5. Connect Registry to AI Auditor
  const setAuditorTx = await registry.setAIAuditor(auditorAddress);
  await setAuditorTx.wait();
  console.log("Registered AI Auditor on QieFlowRegistry");

  // 6. Set AI worker address (using deployer for testing convenience)
  const setWorkerTx = await auditor.setAiWorker(deployer.address);
  await setWorkerTx.wait();
  console.log(`Registered deployer ${deployer.address} as trusted AI worker on QieFlowAIAuditor`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
