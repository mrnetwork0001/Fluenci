import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const REGISTRY = "0xCc92ab9B5D973ad9598C53aC28350C34895a2e33";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);

  const adapter = await (await ethers.getContractFactory("QieIdAdapter")).deploy();
  await adapter.waitForDeployment();
  const addr = await adapter.getAddress();
  console.log("QieIdAdapter:", addr);

  // Sanity: a known .qie owner reads true, a random address reads false.
  console.log("  hasIdentity(mrnetwork owner):", await adapter.hasIdentity("0x07F3D74e8BC5fdbfc02a3187DbD6cd08E96C05a8"));
  console.log("  hasIdentity(0x0000...dead)  :", await adapter.hasIdentity("0x000000000000000000000000000000000000dEaD"));

  const reg = new ethers.Contract(REGISTRY, ["function setQieIdentity(address) external", "function qieIdentity() view returns (address)"], deployer);
  const tx = await reg.setQieIdentity(addr, { gasLimit: 80000n, gasPrice: 1_500_000_000n });
  await tx.wait();
  console.log("wired: registry.setQieIdentity ->", await reg.qieIdentity());
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exitCode = 1; });
