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

// Reputation gating goes live once QIE issues its attestation signing key and
// scores start flowing. Until then the attestor returns 0 for everyone, so the
// merchant option is shown as "not available yet". Flip via env when QIE is live.
export const REPUTATION_LIVE = import.meta.env.VITE_REPUTATION_LIVE === "true";

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
  "function qieIdentity() external view returns (address)",
  "function meetsMerchantPolicy(address merchant, address subscriber) external view returns (bool)",
  "function setAcceptsSubscriptionTransfers(bool accepts) external",
  "function acceptsSubscriptionTransfers(address account) external view returns (bool)",
  "function qieReputation() external view returns (address)",
  "function qiePass() external view returns (address)",
  "function requireMerchantKyc() external view returns (bool)",
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
export const QIE_PASS = "0x98EFC89fA1539B35A6152c35e60BCbbe07a44BbE";
export const QIE_PASS_ABI = ["function verifyIdentity(address user) external view returns (bool)"];

/** Chain the v4 registry lives on. Writes are refused on any other chain. */
export const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_V4_CHAIN_ID || 1990);

// Stablecoins a subscription may be paid in. The registry itself accepts any
// ERC-20, so access checks (the Arcade pass) must allowlist real dollars or a
// worthless self-deployed token would unlock paid features. All are 6 decimals.
// The two bridged tokens are what QIE's Ethereum stable bridge actually mints
// (bridge.qie.digital/stable-bridge) - they are NOT qUSDC.
export const STABLECOINS = [
  { symbol: "qUSDC", label: "qUSDC", address: V4_TOKEN, bridged: false },
  { symbol: "USDC", label: "USDC (bridged from Ethereum)", address: "0x0e93FAcc0a2cfD418403f3AD3EEfB5C8b2dfAec7", bridged: true },
  { symbol: "USDT", label: "USDT (bridged from Ethereum)", address: "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE", bridged: true },
];
export const isStablecoin = (addr) =>
  Boolean(addr) && STABLECOINS.some((t) => t.address.toLowerCase() === String(addr).toLowerCase());
export const stablecoinOf = (addr) =>
  STABLECOINS.find((t) => t.address.toLowerCase() === String(addr || "").toLowerCase()) || null;

// QIEDex (Uniswap-v2 style) - used to quote how much QIE buys a given qUSDC amount.
export const QIEDEX_ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
export const WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
export const QIEDEX_ROUTER_ABI = [
  "function getAmountsIn(uint256 amountOut, address[] path) external view returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])",
];

/**
 * Fluenci Arcade: a first-party merchant. The merchant wallet is set per
 * environment (VITE_ARCADE_MERCHANT) - when it is unset the Arcade shows as
 * "coming soon" rather than taking payments to an address nobody controls.
 * That wallet must be QIE Pass verified: the registry has requireMerchantKyc
 * on, so an unverified merchant can never claim what subscribers pay.
 */
export const ARCADE = {
  merchant: import.meta.env.VITE_ARCADE_MERCHANT || "",
  priceUnits: 1_000_000n,   // $1.00 in 6-decimal stablecoin units
  periodSeconds: 2592000,   // per 30-day month
  priceLabel: "$1/month",
};

/** Minimum native QIE to cover a few transactions (the full onboarding flow is ~0.001 QIE). */
export const LOW_GAS_QIE = 0.002;
/** QIE kept back when a user swaps "max", so they can still pay gas afterwards. */
export const GAS_RESERVE_QIE = 0.01;
