import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const network = await provider.getNetwork();
  console.log(`RPC Connected to Chain ID: ${network.chainId}`);

  const addresses = {
    registry: "0x0d21623aF12FF88B8ad12d2831e1FA715A0A7675",
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0x80b33a1A6625c394Df501991d4Cee0eA780A6C3d",
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef",
    qiedomain: "0x9A676e781A523b5d0C0e43731313A708CB607508"
  };

  for (const [name, addr] of Object.entries(addresses)) {
    const code = await provider.getCode(addr);
    console.log(`${name} (${addr}): code length = ${code.length === 2 ? 0 : (code.length - 2) / 2} bytes`);
  }
}

main().catch(console.error);
