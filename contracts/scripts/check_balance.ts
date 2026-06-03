import { ethers } from "hardhat";

async function main() {
  const userAddress = "0x07F3D74e8BC5fdbfc02a3187DbD6cd08E96C05a8";
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");

  const balance = await provider.getBalance(userAddress);
  console.log(`Address: ${userAddress}`);
  console.log(`Balance: ${ethers.formatEther(balance)} QIE`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
