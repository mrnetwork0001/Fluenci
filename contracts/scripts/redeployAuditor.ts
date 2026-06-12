import { ethers } from "hardhat";

/**
 * Redeploy FluenciAIAuditor pointing to the correct Registry contract.
 * Then register it on the Registry via setAIAuditor().
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const REGISTRY_ADDRESS = "0x13D948a6A3384a744cdB84B0236bbba7CC79cA41";
  const AI_WORKER_ADDRESS = "0xfe5F1D13A31a5B86833ADF4486720331D6e4a6bb";

  // Step 1: Deploy new FluenciAIAuditor pointing to the correct Registry
  console.log("\n--- Step 1: Deploying new FluenciAIAuditor ---");
  const AuditorFactory = await ethers.getContractFactory("FluenciAIAuditor");
  const auditor = await AuditorFactory.deploy(REGISTRY_ADDRESS);
  await auditor.waitForDeployment();
  const auditorAddress = await auditor.getAddress();
  console.log("New FluenciAIAuditor deployed at:", auditorAddress);

  // Step 2: Set the AI worker on the new Auditor
  console.log("\n--- Step 2: Setting AI worker ---");
  const tx1 = await auditor.setAiWorker(AI_WORKER_ADDRESS);
  await tx1.wait();
  console.log("AI worker set to:", AI_WORKER_ADDRESS);

  // Step 3: Register the new Auditor on the Registry
  console.log("\n--- Step 3: Registering Auditor on Registry ---");
  const registryABI = ["function setAIAuditor(address _aiAuditor) external"];
  const registry = new ethers.Contract(REGISTRY_ADDRESS, registryABI, deployer);
  const tx2 = await registry.setAIAuditor(auditorAddress);
  await tx2.wait();
  console.log("Registry.setAIAuditor() called with:", auditorAddress);

  console.log("\n=== DONE ===");
  console.log("Update your server .env with:");
  console.log(`AUDITOR_ADDRESS=${auditorAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
