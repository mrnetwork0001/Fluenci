import { ethers } from "hardhat";

const GAS_PRICE = 1_500_000_000; // 1.5 Gwei
const QIE_PASS_MAINNET = "0x0766Ff824376CEf38CFa5C155A51E90578096e38";

async function waitForReceipt(provider: any, txHash: string, maxWaitMs = 300000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      console.log(`     ✓ Block ${receipt.blockNumber} | Gas: ${receipt.gasUsed.toString()}`);
      return receipt;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for tx ${txHash}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} QIE`);

  const pendingNonce = await provider.getTransactionCount(deployer.address, "pending");
  console.log(`Starting at nonce: ${pendingNonce}`);
  let nonce = pendingNonce;

  // Treasury = deployer address (can be changed later via setTreasury)
  const TREASURY_ADDRESS = deployer.address;

  console.log("\n=== REDEPLOYING REGISTRY v3 (with protocol fee) + AUDITOR v4 ===\n");

  async function deployWith(factory: any, constructorArgs: any[], label: string) {
    console.log(`  Deploying ${label}...`);
    const deployTx = await factory.getDeployTransaction(...constructorArgs);
    const tx = await deployer.sendTransaction({
      ...deployTx,
      gasPrice: GAS_PRICE,
      nonce: nonce,
    });
    console.log(`     tx: ${tx.hash} (nonce: ${nonce})`);
    nonce++;
    const receipt = await waitForReceipt(provider, tx.hash);
    console.log(`     ✅ ${label}: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  }

  async function sendWith(to: string, data: string, label: string) {
    console.log(`  ${label}...`);
    const tx = await deployer.sendTransaction({
      to,
      data,
      gasPrice: GAS_PRICE,
      nonce: nonce,
    });
    console.log(`     tx: ${tx.hash} (nonce: ${nonce})`);
    nonce++;
    await waitForReceipt(provider, tx.hash);
  }

  // 1. Deploy FluenciRegistry v3 (with treasury)
  const FluenciRegistry = await ethers.getContractFactory("FluenciRegistry");
  const registryAddress = await deployWith(
    FluenciRegistry,
    [QIE_PASS_MAINNET, TREASURY_ADDRESS],
    "FluenciRegistry v3"
  );

  // 2. Deploy FluenciAIAuditor v4 (pointing to new Registry)
  const FluenciAIAuditor = await ethers.getContractFactory("FluenciAIAuditor");
  const auditorAddress = await deployWith(
    FluenciAIAuditor,
    [registryAddress],
    "FluenciAIAuditor v4"
  );

  // 3. Connect Registry → Auditor
  const registryIface = new ethers.Interface(["function setAIAuditor(address)"]);
  await sendWith(
    registryAddress,
    registryIface.encodeFunctionData("setAIAuditor", [auditorAddress]),
    "Registry.setAIAuditor"
  );

  // 4. Set AI worker on Auditor (deployer = hot wallet)
  const auditorIface = new ethers.Interface(["function setAiWorker(address)"]);
  await sendWith(
    auditorAddress,
    auditorIface.encodeFunctionData("setAiWorker", [deployer.address]),
    "Auditor.setAiWorker"
  );

  console.log("\n" + "=".repeat(60));
  console.log("  ✅ DEPLOYMENT COMPLETE — Protocol Fee: 0.5%");
  console.log("=".repeat(60));
  console.log(`  Registry v3:  ${registryAddress}`);
  console.log(`  Auditor v4:   ${auditorAddress}`);
  console.log(`  Treasury:     ${TREASURY_ADDRESS}`);
  console.log(`  QIE Pass:     ${QIE_PASS_MAINNET}`);
  console.log(`  Fee:          50 bps (0.5%)`);
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("  1. Update server/.env REGISTRY_ADDRESS and AUDITOR_ADDRESS");
  console.log("  2. Update frontend useFluenci.js contract addresses");
  console.log("  3. Update FluenciDocs.jsx and README.md");
  console.log(`  4. npx hardhat verify --network qieMainnet ${registryAddress} ${QIE_PASS_MAINNET} ${TREASURY_ADDRESS}`);
  console.log(`  5. npx hardhat verify --network qieMainnet ${auditorAddress} ${registryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
