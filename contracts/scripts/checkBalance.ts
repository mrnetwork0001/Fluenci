import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  
  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} QIE`);
  
  // Check current nonce
  const nonce = await provider.getTransactionCount(deployer.address, "latest");
  const pendingNonce = await provider.getTransactionCount(deployer.address, "pending");
  console.log(`Nonce (latest): ${nonce}, (pending): ${pendingNonce}`);
  
  // Get fee data
  const feeData = await provider.getFeeData();
  console.log(`Fee data:`, JSON.stringify({
    gasPrice: feeData.gasPrice?.toString(),
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
  }));

  // Try to look up the latest block to see what gas prices txs are using
  const block = await provider.getBlock("latest", true);
  console.log(`Latest block: ${block?.number}, txCount: ${block?.transactions?.length}`);
  
  // Check a recent tx's gas price from the explorer sample
  try {
    const sampleTx = await provider.getTransaction("0x5676c4e534e44884170c731e285a04343b48fbdfcb4e0435b63a2cf794a47f74");
    if (sampleTx) {
      console.log(`Sample tx gasPrice: ${sampleTx.gasPrice?.toString()}`);
      console.log(`Sample tx maxFeePerGas: ${sampleTx.maxFeePerGas?.toString()}`);
      console.log(`Sample tx maxPriorityFeePerGas: ${sampleTx.maxPriorityFeePerGas?.toString()}`);
      console.log(`Sample tx type: ${sampleTx.type}`);
    }
  } catch(e) {
    console.log("Could not fetch sample tx:", (e as Error).message);
  }

  // Try a simple self-transfer with auto gas
  console.log("\n--- Attempting simple self-transfer (auto gas) ---");
  try {
    const tx = await deployer.sendTransaction({
      to: deployer.address,
      value: 0,
    });
    console.log(`Sent tx: ${tx.hash}`);
    console.log(`Gas price used: ${tx.gasPrice?.toString()}`);
    console.log(`Type: ${tx.type}`);
    
    // Poll for receipt manually
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        console.log(`CONFIRMED in block ${receipt.blockNumber}, gas used: ${receipt.gasUsed.toString()}`);
        console.log(`Effective gas price: ${receipt.gasPrice?.toString()}`);
        return;
      }
      console.log(`  Polling ${i+1}... no receipt yet`);
    }
    console.log("TIMED OUT after 2 minutes");
  } catch(e) {
    console.log("Transfer failed:", (e as Error).message);
  }
}

main().catch(console.error);
