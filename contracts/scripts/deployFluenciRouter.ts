import { ethers } from "hardhat";

const GAS_PRICE = 1_500_000_000; // 1.5 Gwei

// Official QIEDex Router on QIE Mainnet
const QIEDEX_ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";

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
  let nonce = pendingNonce;

  console.log("\n=== DEPLOYING FluenciRouter TO QIE MAINNET ===\n");
  console.log(`  Underlying QIEDex Router: ${QIEDEX_ROUTER}`);

  // Deploy FluenciRouter
  console.log("\n1/1 FluenciRouter...");
  const FluenciRouter = await ethers.getContractFactory("FluenciRouter");
  const deployTx = await FluenciRouter.getDeployTransaction(QIEDEX_ROUTER);
  const tx = await deployer.sendTransaction({
    ...deployTx,
    gasPrice: GAS_PRICE,
    nonce: nonce,
  });
  console.log(`     tx: ${tx.hash} (nonce: ${nonce})`);
  nonce++;

  const receipt = await waitForReceipt(provider, tx.hash);
  const routerAddress = receipt.contractAddress;

  console.log("\n" + "=".repeat(50));
  console.log("  ✅ FluenciRouter DEPLOYED TO QIE MAINNET");
  console.log("=".repeat(50));
  console.log(`  FluenciRouter: ${routerAddress}`);
  console.log(`  QIEDex Router: ${QIEDEX_ROUTER}`);
  console.log("=".repeat(50));
  console.log("\n  Next steps:");
  console.log("  1. Update frontend CONTRACT_ADDRESSES_BY_CHAIN to add fluenciRouter");
  console.log("  2. Update frontend swap logic to route through FluenciRouter");
  console.log("  3. Update backend FLUENCI_ROUTER_ADDRESS in .env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
