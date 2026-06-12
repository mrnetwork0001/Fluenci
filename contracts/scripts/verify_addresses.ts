import { ethers } from "hardhat";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  const network = await provider.getNetwork();
  console.log(`RPC Connected to Chain ID: ${network.chainId}`);

  const addresses = {
    registry: "0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9",
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0xF38d9458d14d916B60026693a76FBe7cDEf651Fa",
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef",
    qiedomain: "0xD0B0432395B2f414A4d9B74BD51523687a02883c"
  };

  for (const [name, addr] of Object.entries(addresses)) {
    const code = await provider.getCode(addr);
    console.log(`${name} (${addr}): code length = ${code.length === 2 ? 0 : (code.length - 2) / 2} bytes`);
  }
}

main().catch(console.error);
