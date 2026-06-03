import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const userAddress = "0x07F3D74e8BC5fdbfc02a3187DbD6cd08E96C05a8";
  const routerAddress = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
  
  // Data from the user's error message
  const txData = "0x7ff36ab5000000000000000000000000000000000000000000000000000000000010099e000000000000000000000000000000000000000000000000000000000000008000000000000000000000000007f3d74e8bc5fdbfc02a3187dbd6cd08e96c05a8000000000000000000000000000000000000000000000000000000006a20a49200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000087904d95bee9e5f24dc8852804b547981a91390000000000000000000000003f43da82ec9a4f5285f10faf1f26eca7319e5da5";

  console.log("Estimating gas for user transaction...");
  try {
    const res = await provider.estimateGas({
      from: userAddress,
      to: routerAddress,
      data: txData,
      value: ethers.parseEther("6")
    });
    console.log("Gas estimation success! Required gas:", res.toString());
  } catch (e: any) {
    console.error("Gas estimation failed with error:", e);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
