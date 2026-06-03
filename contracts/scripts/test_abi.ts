import { ethers } from "hardhat";

const DEX_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
];

async function main() {
  try {
    const iface = new ethers.Interface(DEX_ABI);
    console.log("Success! ABI parsed successfully.");
    console.log("swapExactETHForTokens: ", iface.getFunction("swapExactETHForTokens"));
    console.log("getAmountsOut: ", iface.getFunction("getAmountsOut"));
  } catch (e: any) {
    console.error("Error parsing ABI:", e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
