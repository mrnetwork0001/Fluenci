import { ethers } from "hardhat";

const GAS_PRICE = 1_500_000_000; // 1.5 Gwei
const QIE_PASS_MAINNET = "0x0165878A594ca255338adfa4d48449f69242Eb8F";

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

  // Use pending nonce to avoid stuck transactions
  const pendingNonce = await provider.getTransactionCount(deployer.address, "pending");
  console.log(`Starting at nonce: ${nonceResolve(pendingNonce)}`);
  let nonce = pendingNonce;

  console.log("\n=== DEPLOYING TO QIE MAINNET ===\n");

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

  // Helper to log nonce status
  function nonceResolve(n: number) {
    return n;
  }

  // 1. FluenciRegistry
  console.log("1/2 FluenciRegistry...");
  const FluenciRegistry = await ethers.getContractFactory("FluenciRegistry");
  const registryAddress = await deployWith(FluenciRegistry, [QIE_PASS_MAINNET], "FluenciRegistry");

  // 2. FluenciAIAuditor
  console.log("2/2 FluenciAIAuditor...");
  const FluenciAIAuditor = await ethers.getContractFactory("FluenciAIAuditor");
  const auditorAddress = await deployWith(FluenciAIAuditor, [registryAddress], "FluenciAIAuditor");

  // 3. Connect Registry to Auditor
  console.log("   → Connecting setAIAuditor...");
  const registryIface = new ethers.Interface(["function setAIAuditor(address)"]);
  await sendWith(registryAddress, registryIface.encodeFunctionData("setAIAuditor", [auditorAddress]), "setAIAuditor");

  // 4. Set AI worker address to deployer address (acts as AI hot wallet)
  console.log("   → Setting setAiWorker...");
  const auditorIface = new ethers.Interface(["function setAiWorker(address)"]);
  await sendWith(auditorAddress, auditorIface.encodeFunctionData("setAiWorker", [deployer.address]), "setAiWorker");

  const addresses = {
    registry: registryAddress,
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", // Official Mainnet QUSDC
    qiepass: QIE_PASS_MAINNET, // Live Mainnet QIE Pass
    auditor: auditorAddress,
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef", // Official QIEDex Router
    qiedomain: "0x9A676e781A523b5d0C0e43731313A708CB607508" // Live Mainnet QIE Domains Resolver
  };

  console.log("\n" + "=".repeat(50));
  console.log("  ✅ ALL CONTRACTS DEPLOYED TO QIE MAINNET");
  console.log("=".repeat(50));
  console.log(JSON.stringify(addresses, null, 2));
  console.log("=".repeat(50));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
