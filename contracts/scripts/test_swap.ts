import { ethers } from "hardhat";

const DEX_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
];

async function main() {
  const routerAddress = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
  const path = [
    "0x0087904D95BEe9E5F24dc8852804b547981A9139", // WQIE
    "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"  // QUSDC
  ];

  const privateKey = process.env.PRIVATE_KEY || "0xfe3a3e160db3dd96335940f08821596df0a6ec13199568c1819a4d449b139703";
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Simulating swap for address:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Current QIE Balance:", ethers.formatEther(balance));

  const dexContract = new ethers.Contract(routerAddress, DEX_ABI, wallet);

  try {
    const amounts = await dexContract.getAmountsOut(ethers.parseEther("6"), path);
    const amountOutMin = (amounts[1] * 95n) / 100n;
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    console.log("Parameters prepared:");
    console.log(" - amountOutMin:", amountOutMin.toString());
    console.log(" - deadline:", deadline);
    console.log(" - value: 6 QIE");

    console.log("Simulating transaction estimation...");
    const gasEstimate = await dexContract.swapExactETHForTokens.estimateGas(
      amountOutMin,
      path,
      wallet.address,
      deadline,
      { value: ethers.parseEther("6") }
    );
    console.log("Gas estimation success! Required gas:", gasEstimate.toString());
  } catch (e: any) {
    console.error("Error during transaction simulation:", e);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
