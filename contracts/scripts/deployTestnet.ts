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

  // Use pending nonce to skip any stuck txs
  const pendingNonce = await provider.getTransactionCount(deployer.address, "pending");
  console.log(`Starting at nonce: ${pendingNonce}`);
  let nonce = pendingNonce;

  console.log("\n=== DEPLOYING TO QIE TESTNET (gasPrice: 1.5 Gwei) ===\n");

  // Helper to deploy with explicit nonce
  async function deployWith(factory: any, constructorArgs: any[], label: string) {
    const deployTx = await factory.getDeployTransaction(...constructorArgs);
    const tx = await deployer.sendTransaction({
      ...deployTx,
      gasPrice: GAS_PRICE,
      nonce: nonce,
    });
    console.log(`     tx: ${tx.hash} (nonce: ${nonce})`);
    nonce++;
    const receipt = await waitForReceipt(provider, tx.hash);
    console.log(`     ✅ ${receipt.contractAddress}`);
    return receipt.contractAddress;
  }

  async function sendWith(to: string, data: string, label: string) {
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

  // 1. MockQiePass
  console.log("1/7 MockQiePass...");
  const MockQiePass = await ethers.getContractFactory("MockQiePass");
  const qiePassAddress = await deployWith(MockQiePass, [], "MockQiePass");

  // 2. MockQUSDC
  console.log("2/7 MockQUSDC...");
  const MockQUSDC = await ethers.getContractFactory("MockQUSDC");
  const qusdcAddress = await deployWith(MockQUSDC, [], "MockQUSDC");

  // 3. MockWETH
  console.log("3/7 MockWETH...");
  const MockWETH = await ethers.getContractFactory("MockWETH");
  const wethAddress = await deployWith(MockWETH, [], "MockWETH");

  // 4. FluenciRegistry
  console.log("4/7 FluenciRegistry...");
  const FluenciRegistry = await ethers.getContractFactory("FluenciRegistry");
  const registryAddress = await deployWith(FluenciRegistry, [qiePassAddress], "FluenciRegistry");

  // 5. FluenciAIAuditor
  console.log("5/7 FluenciAIAuditor...");
  const FluenciAIAuditor = await ethers.getContractFactory("FluenciAIAuditor");
  const auditorAddress = await deployWith(FluenciAIAuditor, [registryAddress], "FluenciAIAuditor");

  // 5b. setAIAuditor on Registry
  console.log("   → setAIAuditor...");
  const registryIface = new ethers.Interface(["function setAIAuditor(address)"]);
  await sendWith(registryAddress, registryIface.encodeFunctionData("setAIAuditor", [auditorAddress]), "setAIAuditor");

  // 5c. setAiWorker
  console.log("   → setAiWorker...");
  const auditorIface = new ethers.Interface(["function setAiWorker(address)"]);
  await sendWith(auditorAddress, auditorIface.encodeFunctionData("setAiWorker", [deployer.address]), "setAiWorker");

  // 6. MockQieDex
  console.log("6/7 MockQieDex...");
  const MockQieDex = await ethers.getContractFactory("MockQieDex");
  const dexAddress = await deployWith(MockQieDex, [qusdcAddress, wethAddress], "MockQieDex");

  // 7. QieDomain
  console.log("7/7 QieDomain...");
  const QieDomain = await ethers.getContractFactory("QieDomain");
  const qieDomainAddress = await deployWith(QieDomain, [], "QieDomain");

  // Output
  const addresses = {
    registry: registryAddress,
    qusdc: qusdcAddress,
    weth: wethAddress,
    qiepass: qiePassAddress,
    auditor: auditorAddress,
    qiedex: dexAddress,
    qiedomain: qieDomainAddress,
  };

  console.log("\n" + "=".repeat(50));
  console.log("  ✅ ALL CONTRACTS DEPLOYED TO QIE TESTNET");
  console.log("=".repeat(50));
  console.log(JSON.stringify(addresses, null, 2));
  console.log("=".repeat(50));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
