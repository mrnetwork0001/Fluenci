import { ethers } from "ethers";

async function main() {
  const rpcs = [
    "https://rpc-main2.qiblockchain.online/"
  ];
  
  const addresses = [
    "0x9A676e781A523b5d0C0e43731313A708CB607508",
    "0xD0B0432395B2f414A4d9B74BD51523687a02883c"
  ];

  const userAddress = "0x07f3d74e8bc5fdbfc02a3187dbd6cd08e96c05a8";

  for (const rpc of rpcs) {
    console.log(`\n=== Testing RPC: ${rpc} ===`);
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const chainId = await provider.getNetwork().then(n => n.chainId);
      console.log(`Connected. ChainId: ${chainId}`);

      for (const addr of addresses) {
        const code = await provider.getCode(addr);
        console.log(`Address ${addr} code length: ${code.length > 2 ? (code.length - 2) / 2 : 0} bytes`);

        if (code.length > 2) {
          const abi = [
            "function lookupAddress(address addr) external view returns (string memory)"
          ];
          const contract = new ethers.Contract(addr, abi, provider);
          try {
            const domain = await contract.lookupAddress(userAddress);
            console.log(`  lookupAddress(${userAddress}) -> "${domain}"`);
          } catch (e: any) {
            console.log(`  lookupAddress call failed: ${e.message}`);
          }
        }
      }
    } catch (err: any) {
      console.log(`Failed connecting to RPC: ${err.message}`);
    }
  }
}

main().catch(console.error);
