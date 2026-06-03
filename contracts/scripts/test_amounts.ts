import { ethers } from "hardhat";

const DEX_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
];

async function main() {
  const routerAddress = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
  const path = [
    "0x0087904D95BEe9E5F24dc8852804b547981A9139", // WQIE
    "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"  // QUSDC
  ];

  try {
    const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
    const dexContract = new ethers.Contract(routerAddress, DEX_ABI, provider);
    
    const amounts = await dexContract.getAmountsOut(ethers.parseEther("1"), path);
    console.log("amounts type:", typeof amounts, Array.isArray(amounts));
    console.log("amounts contents:", amounts);
    console.log("amounts[0] type:", typeof amounts[0], amounts[0]);
    console.log("amounts[1] type:", typeof amounts[1], amounts[1]);
    
    const amountOutMin = (amounts[1] * 95n) / 100n;
    console.log("amountOutMin computed successfully:", amountOutMin);
  } catch (e: any) {
    console.error("Error calling getAmountsOut:", e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
