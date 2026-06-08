import { ethers } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const addr = "0x2b51ae4412f79c3c1cb12aa40ea4eceb4e80511a";

  try {
    const code = await provider.getCode(addr);
    console.log(`Address ${addr} code length: ${code.length > 2 ? (code.length - 2) / 2 : 0} bytes`);
  } catch (e: any) {
    console.log(`Failed: ${e.message}`);
  }
}

main().catch(console.error);
