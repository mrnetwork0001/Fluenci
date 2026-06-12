import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const network = await provider.getNetwork();
  console.log(`RPC Connected to Chain ID: ${network.chainId}`);

  const addresses = {
    registry: "0x13D948a6A3384a744cdB84B0236bbba7CC79cA41",
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0x5A2bFC25a951da06dCee2Bf1B7719c43ceB59B02",
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef",
    qiedomain: "0xD0B0432395B2f414A4d9B74BD51523687a02883c"
  };

  for (const [name, addr] of Object.entries(addresses)) {
    const code = await provider.getCode(addr);
    console.log(`${name} (${addr}): code length = ${code.length === 2 ? 0 : (code.length - 2) / 2} bytes`);
  }
}

main().catch(console.error);
