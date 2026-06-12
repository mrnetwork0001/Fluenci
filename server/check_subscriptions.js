const { ethers } = require("ethers");
require("dotenv").config();

const RPC_URL = process.env.RPC_URL || "https://rpc1mainnet.qie.digital";
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS || "0x13D948a6A3384a744cdB84B0236bbba7CC79cA41";
const USER_ADDRESS = "0x07F3D74e8BC5fdbfc02a3187DbD6cd08E96C05a8";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new ethers.Contract(
    REGISTRY_ADDRESS,
    [
      "function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory)",
      "function getSubscriptionDetails(bytes32 subId) external view returns (address subscriber, address merchant, address tokenAddress, uint256 ratePerSecond, uint256 lastClaimedTimestamp, uint256 startTime, uint256 cliffTime, uint256 stopTime, bool active, bool pausedByAI, uint8 disputeState, uint256 claimableAmount)"
    ],
    provider
  );

  console.log("Registry Address:", REGISTRY_ADDRESS);
  console.log("Checking subscriptions for:", USER_ADDRESS);
  try {
    const subs = await registry.getSubscriberSubscriptions(USER_ADDRESS);
    console.log("Subscriptions found:", subs.length);
    for (const subId of subs) {
      const details = await registry.getSubscriptionDetails(subId);
      console.log(`\nSubId: ${subId}`);
      console.log(`Active: ${details.active}`);
      console.log(`PausedByAI: ${details.pausedByAI}`);
      console.log(`RatePerSecond: ${details.ratePerSecond.toString()}`);
      console.log(`Claimable: ${details.claimableAmount.toString()}`);
      
      // Check ERC20 balance
      const token = new ethers.Contract(
        details.tokenAddress,
        ["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"],
        provider
      );
      const balance = await token.balanceOf(USER_ADDRESS);
      const symbol = await token.symbol();
      console.log(`Token Address: ${details.tokenAddress} (${symbol})`);
      console.log(`User Token Balance: ${balance.toString()} (${Number(balance) / 1e6} ${symbol})`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
