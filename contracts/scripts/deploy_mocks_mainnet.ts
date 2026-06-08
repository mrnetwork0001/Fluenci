import { ethers } from "hardhat";

const GAS_PRICE = 1_500_000_000; // 1.5 Gwei

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
  console.log(`Starting nonce: ${pendingNonce}`);
  let nonce = pendingNonce;

  console.log("\n=== DEPLOYING MOCKS TO QIE MAINNET ===\n");

  async function deployWith(factory: any, constructorArgs: any[], label: string) {
    const deployTx = await factory.getDeployTransaction(...constructorArgs);
    const tx = await deployer.sendTransaction({
      ...deployTx,
      gasPrice: GAS_PRICE,
      nonce: nonce,
    });
    console.log(`     Deploying ${label}... tx: ${tx.hash} (nonce: ${nonce})`);
    nonce++;
    const receipt = await waitForReceipt(provider, tx.hash);
    console.log(`     ✅ ${label} Address: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  }

  // 1. Deploy MockQiePass
  const MockQiePass = await ethers.getContractFactory("MockQiePass");
  const qiePassAddress = await deployWith(MockQiePass, [], "MockQiePass");

  // 2. Deploy QieDomain
  const QieDomain = await ethers.getContractFactory("QieDomain");
  const qieDomainAddress = await deployWith(QieDomain, [], "QieDomain");

  // 3. Update QiePass address on FluenciRegistry
  const registryAddress = "0x0d21623aF12FF88B8ad12d2831e1FA715A0A7675";
  console.log(`\nUpdating Registry at ${registryAddress} to point to new qiePass...`);
  const registry = new ethers.Contract(registryAddress, [
    "function setQiePass(address) external"
  ], deployer);

  const txUpdate = await registry.setQiePass(qiePassAddress, {
    gasPrice: GAS_PRICE,
    nonce: nonce
  });
  console.log(`     Updating registry qiePass... tx: ${txUpdate.hash} (nonce: ${nonce})`);
  nonce++;
  await waitForReceipt(provider, txUpdate.hash);
  console.log(`     ✅ Registry updated!`);

  console.log("\nDeployment completed successfully!");
  console.log(`New qiepass address: ${qiePassAddress}`);
  console.log(`New qiedomain address: ${qieDomainAddress}`);
}

main().catch(console.error);
