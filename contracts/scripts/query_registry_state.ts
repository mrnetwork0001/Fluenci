import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const registryAddress = "0x0d21623aF12FF88B8ad12d2831e1FA715A0A7675";
  
  const registryAbi = [
    "function owner() external view returns (address)",
    "function qiePass() external view returns (address)",
    "function aiAuditor() external view returns (address)"
  ];

  const registry = new ethers.Contract(registryAddress, registryAbi, provider);

  try {
    const owner = await registry.owner();
    const qiePass = await registry.qiePass();
    const aiAuditor = await registry.aiAuditor();

    console.log(`Registry Address: ${registryAddress}`);
    console.log(`Owner: ${owner}`);
    console.log(`qiePass: ${qiePass}`);
    console.log(`aiAuditor: ${aiAuditor}`);
  } catch (e) {
    console.error("Failed to query registry state:", e);
  }
}

main().catch(console.error);
