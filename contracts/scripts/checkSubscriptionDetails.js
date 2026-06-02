const { ethers } = require("ethers");

const rpc = "https://rpc4testnet.qie.digital/";
const registryAddress = "0x68ca19Fe37Bebf4f8572c0e3cE8e9e423d7A0707";
const subscriber = "0xcd0a2370f2dc12c1802707b7d9ab3fec891e3c02";

const abi = [
  "function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory)",
  "function getSubscriptionDetails(bytes32 subId) external view returns (address subscriber, address merchant, address tokenAddress, uint256 ratePerSecond, uint256 lastClaimedTimestamp, uint256 startTime, uint256 cliffTime, uint256 stopTime, bool active, bool pausedByAI, uint8 disputeState, uint256 claimableAmount)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(registryAddress, abi, provider);

  console.log(`Querying subscriptions for subscriber: ${subscriber}...`);
  const subIds = await contract.getSubscriberSubscriptions(subscriber);
  console.log(`Found ${subIds.length} subscription IDs.`);

  for (const id of subIds) {
    const details = await contract.getSubscriptionDetails(id);
    console.log(`\nSubscription ID: ${id}`);
    console.log(`- Subscriber: ${details.subscriber}`);
    console.log(`- Merchant: ${details.merchant}`);
    console.log(`- Rate/sec: ${details.ratePerSecond.toString()}`);
    console.log(`- Active: ${details.active}`);
    console.log(`- PausedByAI: ${details.pausedByAI}`);
    console.log(`- DisputeState: ${details.disputeState} (0=NONE, 1=OPEN, 2=RESOLVED)`);
  }
}

main().catch(console.error);
