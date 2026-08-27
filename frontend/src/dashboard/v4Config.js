// FluenciRegistryV4 wiring. Addresses come from env so the v4 cutover is a Vercel
// change rather than a code edit - same pattern as VITE_REGISTRY_ADDRESS for v3.
export const V4_REGISTRY = import.meta.env.VITE_REGISTRY_V4_ADDRESS || "0xCc92ab9B5D973ad9598C53aC28350C34895a2e33";
export const V4_ATTESTOR = import.meta.env.VITE_REPUTATION_ATTESTOR_ADDRESS || "0x1e89d42C5459b4E8e26b4991DA0f7E0C97CD33B7";

// Reputation is an off-chain HTTP service; the base URL is injected, never hardcoded.
export const REPUTATION_API = import.meta.env.VITE_REPUTATION_API_URL || "";

// The streaming token. Sourced here rather than from useFluenci, whose chain map
// falls back to the mainnet entry on any unknown chain - which meant a local
// deploy tried to stream mainnet qUSDC that the local registry has never seen.
export const V4_TOKEN = import.meta.env.VITE_QUSDC_ADDRESS || "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

export const V4_CONFIGURED = Boolean(V4_REGISTRY);

export const QUSDC_DECIMALS = 6;

/** Gate enum, mirrored from FluenciRegistryV4. */
export const GATE = { OPEN: 0, QIE_ID: 1, QIE_PASS: 2, MIN_REPUTATION: 3 };

export const PERIOD_SECONDS = {
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2592000, // 30 days, matching the contract's MIN/MAX bounds
};

export const ERC20_ABI = [
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

export const REGISTRY_V4_ABI = [
  "function createSubscription(address merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 cliffTime, uint256 stopTime) external returns (bytes32)",
  "function claimStream(bytes32 subId) external",
  "function terminateStream(bytes32 subId) external",
  "function openDispute(bytes32 subId) external",
  "function resumeStream(bytes32 subId) external",
  "function previewOwed(bytes32 subId) external view returns (uint256)",
  "function getSubscription(bytes32 subId) external view returns (tuple(address subscriber,address merchant,address tokenAddress,uint256 amountPerPeriod,uint256 periodSeconds,uint256 billedSeconds,uint256 settledAmount,uint256 settledFees,uint256 feeDust,uint256 lastTickTimestamp,uint256 startTime,uint256 cliffTime,uint256 stopTime,bool active,bool pausedByAI,uint8 dispute))",
  "function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[])",
  "function getMerchantSubscriptions(address merchant) external view returns (bytes32[])",
  "function setSpendCap(address merchant, uint256 maxAmount, uint256 periodSeconds) external",
  "function clearSpendCap(address merchant) external",
  "function remainingAllowance(address subscriber, address merchant) external view returns (uint256)",
  "function spendCaps(address subscriber, address merchant) external view returns (uint256 maxAmount, uint256 periodSeconds, uint256 windowStart, uint256 spentInWindow, bool set)",
  "function setMerchantPolicy(uint8 gate, uint256 minReputation) external",
  "function getMerchantGate(address merchant) external view returns (uint8 gate, uint256 minReputation)",
  "function meetsMerchantPolicy(address merchant, address subscriber) external view returns (bool)",
  "function setAcceptsSubscriptionTransfers(bool accepts) external",
  "function acceptsSubscriptionTransfers(address account) external view returns (bool)",
  "function qieReputation() external view returns (address)",
  "function qiePass() external view returns (address)",
  "function protocolFeeBps() external view returns (uint256)",
  "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 cliffTime, uint256 stopTime)",
];

export const ATTESTOR_ABI = [
  "function getAttestation(address user) external view returns (uint256 score, string tier, string modelVersion, uint256 issuedAt, uint256 expiresAt, bool valid)",
  "function getScore(address user) external view returns (uint256)",
  "function isValid(address user) external view returns (bool)",
  "function submitAttestation((address wallet,uint256 score,string tier,string modelVersion,uint256 issuedAt,uint256 expiresAt,uint256 chainId) a, bytes signature) external",
];

/// QIE Pass and the registry live on mainnet regardless of where v4 is pointed,
/// so identity reads always go to mainnet RPC.
export const MAINNET_RPC = "https://rpc1mainnet.qie.digital";
export const QIE_PASS = "0x0766Ff824376CEf38CFa5C155A51E90578096e38";
export const QIE_PASS_ABI = ["function verifyIdentity(address user) external view returns (bool)"];
