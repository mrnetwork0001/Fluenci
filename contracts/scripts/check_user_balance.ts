import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const userAddress = "0x07F3D74e8BC5fdbfc02a3187DbD6cd08E96C05a8";
  const qUSDCAddress = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
  const routerAddress = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";

  console.log(`Checking details for address: ${userAddress}`);
  
  const balance = await provider.getBalance(userAddress);
  console.log(`Native QIE Balance: ${ethers.formatEther(balance)} QIE`);

  const erc20Abi = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
  ];

  try {
    const qUSDC = new ethers.Contract(qUSDCAddress, erc20Abi, provider);
    const qUSDCBal = await qUSDC.balanceOf(userAddress);
    const decimals = await qUSDC.decimals();
    console.log(`qUSDC Balance: ${ethers.formatUnits(qUSDCBal, decimals)} qUSDC`);
  } catch (e) {
    console.error("Failed to query qUSDC balance:", e);
  }

  // Check Router amountsOut
  const routerAbi = [
    "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
  ];
  const wqie = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
  const path = [wqie, qUSDCAddress];
  
  try {
    const router = new ethers.Contract(routerAddress, routerAbi, provider);
    const amounts = await router.getAmountsOut(ethers.parseEther("6"), path);
    console.log(`getAmountsOut for 6 QIE: ${ethers.formatUnits(amounts[1], 6)} qUSDC`);
  } catch (e) {
    console.error("Failed to query getAmountsOut:", e);
  }
}

main().catch(console.error);
