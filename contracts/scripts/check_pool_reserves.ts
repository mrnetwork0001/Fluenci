import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const routerAddress = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
  const wqieAddress = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
  const qUSDCAddress = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

  const routerAbi = [
    "function factory() external view returns (address)",
    "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
  ];
  
  const factoryAbi = [
    "function getPair(address tokenA, address tokenB) external view returns (address)"
  ];

  const pairAbi = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
  ];

  const router = new ethers.Contract(routerAddress, routerAbi, provider);
  const factoryAddress = await router.factory();
  console.log(`Factory address: ${factoryAddress}`);

  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);
  const pairAddress = await factory.getPair(wqieAddress, qUSDCAddress);
  console.log(`Pair address: ${pairAddress}`);

  if (pairAddress === ethers.ZeroAddress) {
    console.log("No pair exists for WQIE and qUSDC!");
    return;
  }

  const pair = new ethers.Contract(pairAddress, pairAbi, provider);
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const reserves = await pair.getReserves();

  const isToken0Wqie = token0.toLowerCase() === wqieAddress.toLowerCase();
  const reserveWqie = isToken0Wqie ? reserves.reserve0 : reserves.reserve1;
  const reserveQusdc = isToken0Wqie ? reserves.reserve1 : reserves.reserve0;

  console.log(`WQIE Reserve: ${ethers.formatEther(reserveWqie)} WQIE`);
  console.log(`qUSDC Reserve: ${ethers.formatUnits(reserveQusdc, 6)} qUSDC`);

  // Check quotes for different inputs
  for (const amount of ["0.1", "1", "3", "6", "10", "20", "50"]) {
    try {
      const amounts = await router.getAmountsOut(ethers.parseEther(amount), [wqieAddress, qUSDCAddress]);
      console.log(`Quote for ${amount} QIE: ${ethers.formatUnits(amounts[1], 6)} qUSDC`);
    } catch (e) {
      console.log(`Quote for ${amount} QIE: Failed (${(e as Error).message})`);
    }
  }
}

main().catch(console.error);
