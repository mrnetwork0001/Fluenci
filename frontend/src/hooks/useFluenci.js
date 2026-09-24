import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import EthereumProvider from "@walletconnect/ethereum-provider";
import { API_BASE_URL, V3_WRITES_FROZEN } from "../config";
import { resolveQieAddress, resolveQieName } from "../dashboard/qieName";
import { V4_REGISTRY } from "../dashboard/v4Config";

// ABI definitions
const REGISTRY_ABI = [
  "function createSubscription(address merchant, address tokenAddress, uint256 ratePerSecond, uint256 cliffTime, uint256 stopTime) external returns (bytes32)",
  "function claimStream(bytes32 subId) external",
  "function resumeStream(bytes32 subId) external",
  "function terminateStream(bytes32 subId) external",
  "function openDispute(bytes32 subId) external",
  "function resolveDispute(bytes32 subId, uint256 subscriberRefund, uint256 merchantShare, bytes calldata signature) external",
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory)",
  "function getMerchantSubscriptions(address merchant) external view returns (bytes32[] memory)",
  "function getSubscriptionDetails(bytes32 subId) external view returns (address subscriber, address merchant, address tokenAddress, uint256 ratePerSecond, uint256 lastClaimedTimestamp, uint256 startTime, uint256 cliffTime, uint256 stopTime, bool active, bool pausedByAI, uint8 disputeState, uint256 claimableAmount)",
  "function qiePass() external view returns (address)",
  "function aiAuditor() external view returns (address)"
];

const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external"
];

const QIEPASS_ABI = [
  "function verifyIdentity(address user) external view returns (bool)",
  "function registerIdentity(address user, bool status) external"
];

const DEX_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[])",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
];

// QIE Domain resolution is handled via the QIE Explorer API (no onchain reverse lookup available)
// Official QIE Domain Registry: 0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed
const DOMAIN_ABI = [
  "function resolveDomain(string domainName) external view returns (address)",
  "function registerDomain(string domainName, address owner) external",
  "function getDomainOwner(string domainName) external view returns (address)"
];

const CONTRACT_ADDRESSES_BY_CHAIN = {
  1990: { // QIE Mainnet
    // v4 cutover: set VITE_REGISTRY_ADDRESS in Vercel to repoint without a code change.
    // The v3 literal stays as the fallback, so behaviour is identical while it is unset.
    registry: import.meta.env.VITE_REGISTRY_ADDRESS || "0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9",
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", // Official QUSDC
    qiepass: "0x98EFC89fA1539B35A6152c35e60BCbbe07a44BbE",
    auditor: "0xF38d9458d14d916B60026693a76FBe7cDEf651Fa",
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef", // Official QIEDex Router
    fluenciRouter: "0x75475647f52531D4086296415392E4AA94b92de7", // FluenciRouter (wraps QieDex with onchain attribution)
    qiedomain: "0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed" // Official QIE Domain Registry (mainnet)
  }
};

const MAINNET_CHAIN_ID = 1990;
const MAINNET_RPC_URL = "https://rpc1mainnet.qie.digital";
const MAINNET = CONTRACT_ADDRESSES_BY_CHAIN[MAINNET_CHAIN_ID];
const WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139";

// One shared mainnet provider, pinned to chain 1990. Swaps use it instead of
// getReadProvider(), whose chainId comes from the render that created the
// closure and is stale right after the wallet is switched to mainnet.
let mainnetRpc = null;
const mainnetProvider = () => {
  if (!mainnetRpc) mainnetRpc = new ethers.JsonRpcProvider(MAINNET_RPC_URL, MAINNET_CHAIN_ID, { staticNetwork: true });
  return mainnetRpc;
};

// QIE Pass status is read from the adapter the v4 registry enforces, over the
// same RPC the v2 dashboard reads it with, so v1 and v2 can never disagree and
// a re-pointed adapter is picked up without a code change.
const V4_RPC_URL = import.meta.env.VITE_V4_RPC_URL || MAINNET_RPC_URL;
let identityRpc = null;
const identityProvider = () => {
  if (V4_RPC_URL === MAINNET_RPC_URL) return mainnetProvider();
  if (!identityRpc) identityRpc = new ethers.JsonRpcProvider(V4_RPC_URL);
  return identityRpc;
};

async function readQiePassVerified(address) {
  const rp = identityProvider();
  const passAddr = await new ethers.Contract(V4_REGISTRY, REGISTRY_ABI, rp).qiePass();
  if (!passAddr || passAddr === ethers.ZeroAddress) return false;
  return Boolean(await new ethers.Contract(passAddr, QIEPASS_ABI, rp).verifyIdentity(address));
}

const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

// Error pages and empty bodies should surface as "no data", not as a JSON parse error.
const readJson = async (res) => {
  try { return (await res.json()) || {}; } catch { return {}; }
};

const IDLE_KYC = { status: "idle", requestId: null, redirectUrl: null, error: null, message: null, txHash: null, account: null };

const KYC_POLL_MS = 10000;
// QIE's requests expire after about an hour; stop asking well before that.
const KYC_MAX_WAIT_MS = 30 * 60 * 1000;
const CLAIM_RETRY_MS = 15000;
const CLAIM_MAX_WAIT_MS = 10 * 60 * 1000;
const NOT_ONCHAIN_YET = "Your verification is not recorded on-chain yet. Checking again shortly.";

// QIE statuses that end a request. Anything else keeps the poll going.
const KYC_TERMINAL = {
  consent_rejected: { status: "error", error: "The request was declined in QIE Wallet. Start again to verify." },
  expired: { status: "expired", error: "This QIE Pass request expired. Start a new one to verify." },
  failed: { status: "error", error: "QIE Pass reported this request as failed. Start a new one to verify." },
};

// v3's owner key is burned and its QIE Pass gate is the retired self-grant mock,
// so nothing new goes into it. Cancelling and revoking stay open.
const V3_FROZEN = {
  create: "New streams on the legacy registry are closed. Existing streams can still be cancelled here.",
  approve: "New approvals to the legacy registry are closed. You can still revoke an existing approval.",
  claim: "Claiming from the legacy registry is turned off while it is retired.",
};

export function useFluenci() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [qieBalance, setQieBalance] = useState("0");
  
  // Token states
  const [qusdcBalance, setQusdcBalance] = useState("0");
  const [qusdcAllowance, setQusdcAllowance] = useState("0");

  // Tagged with the wallet it was read for, so a newly connected wallet never
  // inherits the previous one's verification while its own read is in flight.
  const [passState, setPassState] = useState({ account: "", verified: false });
  const recordPassState = useCallback((addr, verified) =>
    setPassState((prev) => (prev.verified === verified && sameAddress(prev.account, addr) ? prev : { account: addr, verified })), []);
  const qiePassVerified = passState.verified && sameAddress(passState.account, account);
  const [accountDomain, setAccountDomain] = useState("");
  const [announcedProviders, setAnnouncedProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setErrorRaw] = useState("");
  const errorTimerRef = useRef(null);

  // Auto-dismiss errors after 5 seconds
  const setError = (msg) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorRaw(msg);
    if (msg) {
      errorTimerRef.current = setTimeout(() => setErrorRaw(""), 5000);
    }
  };

  const clearError = () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorRaw("");
  };

  // QIE Pass verification flow.
  // status: idle | creating | pending_kyc | pending_consent | claiming | pending_onchain | verified | expired | error
  // "verified" is only ever set once the server confirmed the on-chain write AND
  // our own read of the registry's adapter agrees (see passVerified below).
  const [kycFlow, setKycState] = useState(IDLE_KYC);
  // A flow belongs to the wallet that started it - the server binds the request to that wallet.
  const kycState = kycFlow.account && sameAddress(kycFlow.account, account) ? kycFlow : IDLE_KYC;
  const kycCtxRef = useRef(null);   // the running flow: { wallet, requestId, phase, ... }
  const kycTimerRef = useRef(null);
  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);

  // Transaction modal state
  const [txState, setTxState] = useState({
    status: "idle", // idle | preparing | awaiting_signature | broadcasting | confirming | confirmed | error
    action: "",
    hash: "",
    error: ""
  });

  // title/note belong to the step that set them (e.g. the QIE Pass result);
  // a later step of another transaction must not inherit them.
  const setTxStep = (status, extra = {}) => {
    setTxState(prev => ({ ...prev, title: undefined, note: undefined, status, ...extra }));
  };

  const resetTx = () => {
    setTxState({ status: "idle", action: "", hash: "", error: "" });
    setLoading(false);
  };
  const [subscriberStreams, setSubscriberStreams] = useState([]);
  const [merchantStreams, setMerchantStreams] = useState([]);
  const [realtimeClaimables, setRealtimeClaimables] = useState({});

  // Dynamic contract addresses configuration
  const [contracts, setContracts] = useState({
    registry: "",
    qusdc: "",
    qiepass: "",
    auditor: "",
    qiedex: "",
    fluenciRouter: "",
    qiedomain: ""
  });

  // Automatically update contract addresses based on connected network chainId.
  // Kept as state + effect because updateContractAddresses merges into it too.
  useEffect(() => {
    const config = CONTRACT_ADDRESSES_BY_CHAIN[chainId] || CONTRACT_ADDRESSES_BY_CHAIN[1990];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContracts(config);
  }, [chainId]);

  const updateContractAddresses = (newConfig) => {
    setContracts((prev) => ({ ...prev, ...newConfig }));
  };

  const activeProviderRef = useRef(null);

  // The wallet the user actually connected (QIE extension, WalletConnect/QIE
  // Mobile, or another EIP-6963 wallet). Exposed so the v2 hooks send through
  // it instead of window.ethereum - otherwise QIE Mobile users could connect
  // but never sign an approve or subscribe. Stable identity on purpose.
  const getActiveProvider = useCallback(() => activeProviderRef.current || window.ethereum || null, []);

  const getProviderAndSigner = async () => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected) throw new Error("No Web3 wallet detected");
    const provider = new ethers.BrowserProvider(injected);
    const signer = await provider.getSigner();
    return { provider, signer };
  };

  // No QIE testnet branch: CONTRACT_ADDRESSES_BY_CHAIN only knows mainnet, so a
  // wallet on testnet (1983) used to have mainnet addresses read on the testnet
  // RPC, where they have no code - balances and quotes silently came back wrong.
  const getReadProvider = useCallback(() => {
    if (chainId === 31337 || chainId === 1337) {
      return new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    }
    return mainnetProvider();
  }, [chainId]);

  // Wait for a transaction by polling getTransactionReceipt
  // (waitForTransaction hangs on QIE RPC due to broken eth_getFilterChanges)
  const waitForTx = async (tx, readProvider = getReadProvider()) => {
    const TIMEOUT_MS = 60000; // 60 second timeout
    const POLL_INTERVAL = 3000; // poll every 3 seconds
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const receipt = await readProvider.getTransactionReceipt(tx.hash);
          if (receipt && receipt.blockNumber) {
            // A reverted transaction is still mined - don't report it as done.
            if (receipt.status === 0) {
              return reject(new Error(`Transaction ${tx.hash.slice(0, 10)}… failed on-chain, so it had no effect. Only the network fee was used.`));
            }
            return resolve(receipt);
          }
        } catch (e) {
          // RPC hiccup - keep polling
        }

        if (Date.now() - startTime > TIMEOUT_MS) {
          return reject(new Error(
            `Transaction sent (${tx.hash.slice(0, 10)}…) but confirmation timed out. ` +
            `Check your wallet or block explorer for status.`
          ));
        }

        setTimeout(poll, POLL_INTERVAL);
      };
      poll();
    });
  };

  // Switch network to QIE Mainnet and force RPC sync
  // Switch first (works when the wallet already knows QIE, which is the common
  // case); only add the network when the wallet reports it has never seen it.
  // Calling wallet_addEthereumChain alone fails or no-ops in several wallets.
  const switchToQieMainnet = async () => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected) return false;
    try {
      await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7c6" }] });
    } catch (switchErr) {
      const unknownChain = switchErr?.code === 4902 || switchErr?.data?.originalError?.code === 4902 ||
        /unrecognized|not been added|unknown chain/i.test(switchErr?.message || "");
      if (!unknownChain) {
        setError("Switch your wallet to QIE Mainnet to continue.");
        return false;
      }
      try {
        await injected.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x7C6",
            chainName: "QIE Mainnet",
            nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
            rpcUrls: ["https://rpc1mainnet.qie.digital"],
            blockExplorerUrls: ["https://mainnet.qie.digital/"]
          }]
        });
      } catch (err) {
        console.error("Failed to add QIE Mainnet", err);
        setError("Could not add QIE Mainnet to your wallet. Add it manually and try again.");
        return false;
      }
    }
    try {
      const hex = await injected.request({ method: "eth_chainId" });
      setChainId(Number(hex));
    } catch { /* the chainChanged listener will catch up */ }
    setError("");
    return true;
  };

  const connectWallet = async (providerDetail = null) => {
    setError("");
    setLoading(true);
    try {
      let targetProvider = null;
      if (providerDetail && providerDetail.provider) {
        targetProvider = providerDetail.provider;
        activeProviderRef.current = providerDetail.provider;
      } else {
        // Prioritize QIE Wallet detection to prevent hijacking by OKX, Rabby, etc.
        const qieAnnounced = announcedProviders.find(
          (p) => p.info.name.toLowerCase().includes("qie") || p.info.rdns.toLowerCase().includes("qie")
        );
        
        if (qieAnnounced && qieAnnounced.provider) {
          targetProvider = qieAnnounced.provider;
          activeProviderRef.current = qieAnnounced.provider;
        } else if (window.ethereum) {
          // Check if QIE Wallet is present in window.ethereum.providers list (injected by multiple extensions)
          let qieProviderObj = null;
          if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
            qieProviderObj = window.ethereum.providers.find(p => p.isQieWallet || p.isQIE);
          } else if (window.ethereum.isQieWallet || window.ethereum.isQIE) {
            qieProviderObj = window.ethereum;
          }

          if (qieProviderObj) {
            targetProvider = qieProviderObj;
            activeProviderRef.current = qieProviderObj;
          } else {
            // Fallback to window.ethereum if QIE Wallet is not detected
            targetProvider = window.ethereum;
            activeProviderRef.current = window.ethereum;
          }
        } else {
          throw new Error("Please install Qie Wallet to interact with Fluenci");
        }
      }

      const accounts = await targetProvider.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      setAccount(address);

      const provider = new ethers.BrowserProvider(targetProvider);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Fetch balances, allowances, and QIE Pass status
  const fetchAccountState = useCallback(async () => {
    if (!account) return;

    // Read first and on its own, so a failing balance read below can never
    // leave an earlier verification standing. Unreachable reads as unverified.
    const verified = await readQiePassVerified(account).catch((err) => {
      console.warn("Failed to fetch QIE Pass status, defaulting to unverified:", err.message);
      return false;
    });
    recordPassState(account, verified);

    try {
      const provider = getReadProvider();

      // Native QIE Balance
      const qieBalVal = await provider.getBalance(account);
      setQieBalance(ethers.formatEther(qieBalVal));

      // Fetch QUSDC Balance & Allowance
      if (contracts.qusdc) {
        const qusdcContract = new ethers.Contract(contracts.qusdc, ERC20_ABI, provider);
        const bal = await qusdcContract.balanceOf(account);
        setQusdcBalance(ethers.formatUnits(bal, 6));

        if (contracts.registry) {
          const allow = await qusdcContract.allowance(account, contracts.registry);
          setQusdcAllowance(ethers.formatUnits(allow, 6));
        }
      }

      // Fetch the connected account's primary .qie name.
      // QIE ships a reverse resolver at 0x76ec8ed3… (deployed by QIE's core
      // deployer), so this is one eth_call. The old comment here claimed no
      // reverse lookup existed, which is why this used to scan the wallet's
      // whole transaction history; that scan is kept below only as a fallback,
      // and it reports the original registrant rather than the current owner.
      let primaryName = null;
      try {
        primaryName = await resolveQieName(account, getReadProvider());
        if (primaryName) setAccountDomain(primaryName);
      } catch (e) {
        console.warn("Reverse .qie resolution failed, falling back to history scan:", e.message);
      }

      // Only scan history when the resolver had no answer - otherwise the scan's
      // (possibly stale) result would overwrite the authoritative one.
      if (!primaryName) {
        const QIE_DOMAIN_REGISTRY = "0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed";
        const REGISTER_SELECTOR = "0xf2101e95";
        try {
          const explorerUrl = `https://mainnet.qie.digital/api?module=account&action=txlist&address=${account}&startblock=0&endblock=99999999&sort=desc`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
          const resp = await fetch(explorerUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          const txData = await resp.json();
          let domain = "";
          if (txData.status === "1" && txData.result) {
            const domainTx = txData.result.find(tx =>
              tx.to?.toLowerCase() === QIE_DOMAIN_REGISTRY.toLowerCase() &&
              tx.input?.startsWith(REGISTER_SELECTOR) &&
              tx.isError === "0"
            );
            if (domainTx) {
              const params = "0x" + domainTx.input.slice(10);
              const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["string", "string[]", "string[]"],
                params
              );
              domain = decoded[0]; // First param is the domain name (e.g. "mrnetwork.qie")
            }
          }
          setAccountDomain(domain || "");
        } catch (err) {
          console.warn("QIE Domain lookup via explorer failed for", account, err.message);
          setAccountDomain("");
        }
      }
    } catch (err) {
      console.error("Failed to fetch account state", err);
    }
  }, [account, contracts, recordPassState]);

  // Fetch stream details
  const fetchSubscriptions = useCallback(async () => {
    if (!account || !contracts.registry) return;

    try {
      const provider = getReadProvider();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, provider);

      // Fetch subscriber streams
      const subIds = await registryContract.getSubscriberSubscriptions(account);
      const subDetailsList = await Promise.all(
        subIds.map(async (id) => {
          const details = await registryContract.getSubscriptionDetails(id);
          const isUSDC = details[2].toLowerCase() === (contracts.qusdc || "").toLowerCase();
          const decimalScalar = isUSDC ? 6 : 18;
          return {
            id,
            subscriber: details[0],
            merchant: details[1],
            tokenAddress: details[2],
            tokenSymbol: isUSDC ? "QUSDC" : "Unknown",
            ratePerSecond: Number(details[3]),
            lastClaimedTimestamp: Number(details[4]),
            startTime: Number(details[5]),
            cliffTime: Number(details[6]),
            stopTime: Number(details[7]),
            active: details[8],
            pausedByAI: details[9],
            disputeState: Number(details[10]), // 0 = None, 1 = Open, 2 = Resolved
            claimableAmount: Number(details[11]) / (10 ** decimalScalar)
          };
        })
      );
      setSubscriberStreams(subDetailsList);

      // Fetch merchant streams
      const merIds = await registryContract.getMerchantSubscriptions(account);
      const merDetailsList = await Promise.all(
        merIds.map(async (id) => {
          const details = await registryContract.getSubscriptionDetails(id);
          const isUSDC = details[2].toLowerCase() === (contracts.qusdc || "").toLowerCase();
          const decimalScalar = isUSDC ? 6 : 18;
          return {
            id,
            subscriber: details[0],
            merchant: details[1],
            tokenAddress: details[2],
            tokenSymbol: isUSDC ? "QUSDC" : "Unknown",
            ratePerSecond: Number(details[3]),
            lastClaimedTimestamp: Number(details[4]),
            startTime: Number(details[5]),
            cliffTime: Number(details[6]),
            stopTime: Number(details[7]),
            active: details[8],
            pausedByAI: details[9],
            disputeState: Number(details[10]),
            claimableAmount: Number(details[11]) / (10 ** decimalScalar)
          };
        })
      );
      setMerchantStreams(merDetailsList);
    } catch (err) {
      console.error("Failed to fetch subscriptions", err);
    }
  }, [account, contracts]);

  // Generic direct EIP-1193 JSON-RPC transaction sender to prevent browser wallet hangs
  const executeDirectTx = async (toAddress, abi, methodName, args, value = "0x0", gasLimit = 200000n) => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected) throw new Error("No Web3 wallet detected");

    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData(methodName, args);
    const gasHex = "0x" + gasLimit.toString(16);

    const txHash = await injected.request({
      method: "eth_sendTransaction",
      params: [{
        from: account,
        to: toAddress,
        data: data,
        value: value,
        gas: gasHex
      }]
    });

    if (!txHash) {
      throw new Error("No transaction hash returned from wallet");
    }

    return { hash: txHash };
  };

  // Mint mock stablecoins / WETH
  const mintMockTokens = async (tokenSymbol, amount) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Minting ${amount} ${tokenSymbol}`, hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tokenAddress = tokenSymbol === "QUSDC" ? contracts.qusdc : contracts.weth;
      const decimals = tokenSymbol === "QUSDC" ? 6 : 18;
      
      const tx = await executeDirectTx(
        tokenAddress,
        ERC20_ABI,
        "mint",
        [account, ethers.parseUnits(amount, decimals)],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Approve Tokens - approves a sensible cap (10,000 QUSDC) instead of unlimited.
  // amount is in whole QUSDC; "0" revokes the approval.
  const approveToken = async (tokenSymbol, amount = "10000") => {
    let approveAmount;
    try {
      approveAmount = ethers.parseUnits(String(amount), 6);
    } catch {
      setError("Enter a valid QUSDC amount to approve.");
      return;
    }
    const revoking = approveAmount === 0n;
    if (V3_WRITES_FROZEN && !revoking) {
      setError(V3_FROZEN.approve);
      return;
    }
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: revoking ? "Revoking QUSDC approval" : "Approving QUSDC", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.qusdc,
        ERC20_ABI,
        "approve",
        [contracts.registry, approveAmount],
        "0x0",
        100000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // ==========================================
  // QIE PASS VERIFICATION
  // ==========================================
  // /qiepass/verify binds a request to the connected wallet, /qiepass/status is
  // polled until the user consents, and /qiepass/claim records the result on the
  // adapter for that bound wallet. The wallet only counts as verified once our
  // own read of the registry's adapter says so.

  const SERVER_URL = API_BASE_URL;

  const isLiveFlow = (ctx) => kycCtxRef.current === ctx && sameAddress(accountRef.current, ctx.wallet);

  const stopKycFlow = () => {
    kycCtxRef.current = null;
    if (kycTimerRef.current) {
      clearTimeout(kycTimerRef.current);
      kycTimerRef.current = null;
    }
  };

  // Drop a flow and its in-progress status, so reconnecting that wallet later
  // doesn't show a request that nothing is polling any more. A modal still on
  // one of its steps is closed too, since nothing would finish that spinner;
  // a result (confirmed/error) stays up.
  const abandonKyc = (ctx) => {
    if (kycCtxRef.current === ctx) stopKycFlow();
    setKycState((prev) => (sameAddress(prev.account, ctx.wallet) ? IDLE_KYC : prev));
    setTxState((prev) => (prev.qiePassFlow === ctx && prev.status !== "confirmed" && prev.status !== "error"
      ? { status: "idle", action: "", hash: "", error: "" }
      : prev));
  };

  // Switching wallets abandons the running flow; the server bound it to the old one.
  useEffect(() => {
    const ctx = kycCtxRef.current;
    if (ctx && !sameAddress(account, ctx.wallet)) abandonKyc(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a wallet change should abandon
  }, [account]);

  // An in-progress step of this flow. qiePassFlow tags the modal as the flow's,
  // so abandonKyc can close it, even if the modal was closed or reused meanwhile.
  const showKycStep = (ctx, action) => setTxStep("confirming", { action, qiePassFlow: ctx });

  const failKyc = (ctx, status, message) => {
    if (!isLiveFlow(ctx)) return;
    stopKycFlow();
    setKycState((prev) => ({ ...prev, status, error: message, message: null }));
    setTxStep("error", { error: message, title: "QIE Pass verification stopped", note: "" });
  };

  // Only reached after the server confirmed the write AND our own read agrees.
  const passVerified = (ctx, txHash) => {
    if (!isLiveFlow(ctx)) return;
    stopKycFlow();
    recordPassState(ctx.wallet, true);
    setKycState((prev) => ({ ...prev, status: "verified", error: null, message: null, txHash: txHash || null }));
    setTxState({
      status: "confirmed", action: "QIE Pass verified", hash: txHash || "", error: "",
      title: "QIE Pass verified", note: "Your verification is recorded on-chain."
    });
  };

  // One /qiepass/claim round. The server writes to the wallet it bound at
  // /verify; walletAddress in the body only lets it refuse a mismatch.
  const claimRound = async (ctx) => {
    const res = await fetch(`${SERVER_URL}/qiepass/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: ctx.requestId, walletAddress: ctx.wallet })
    });
    const data = await readJson(res);
    if (res.status === 202 || data.pending) return { verified: false, message: data.error || null };
    if (!res.ok || !data.success || !data.verified || !data.onchain) {
      const err = new Error(data.error || "QIE Pass verification failed.");
      err.status = res.status;
      throw err;
    }
    // The server's word is not enough on its own. An RPC that lags behind the
    // server's lands in the pending branch and is simply asked again.
    const onChain = await readQiePassVerified(ctx.wallet).catch(() => false);
    return { verified: onChain, txHash: data.txHash || null, message: null };
  };

  const scheduleKyc = (ctx, ms) => {
    if (kycTimerRef.current) clearTimeout(kycTimerRef.current);
    kycTimerRef.current = setTimeout(() => { advanceKyc(ctx); }, ms);
  };

  // Claim, then finish or keep asking: after a 202 the server is still writing,
  // and after a dropped connection we can't know whether the claim arrived.
  // Errors the server reports end the flow with its own text.
  const settleClaim = async (ctx) => {
    try {
      const r = await claimRound(ctx);
      if (!isLiveFlow(ctx)) return;
      if (r.verified) {
        passVerified(ctx, r.txHash);
        return;
      }
      if (ctx.phase !== "onchain") {
        ctx.phase = "onchain";
        ctx.phaseSince = Date.now();
        showKycStep(ctx, "Waiting for the on-chain record");
      }
      setKycState((prev) => ({ ...prev, status: "pending_onchain", error: null, message: r.message || NOT_ONCHAIN_YET }));
    } catch (err) {
      if (!isLiveFlow(ctx)) return;
      if (err.status && err.status !== 429) {
        failKyc(ctx, "error", err.message);
        setError(err.message);
        return;
      }
      console.warn("QIE Pass claim did not complete, retrying:", err.message);
    }
  };

  const startClaim = async (ctx) => {
    ctx.phase = "claiming";
    ctx.phaseSince = Date.now();
    setKycState((prev) => ({ ...prev, status: "claiming", error: null, message: null }));
    showKycStep(ctx, "Recording your QIE Pass on-chain");
    await settleClaim(ctx);
  };

  // One round of the flow, from the timer or from "Check status". It schedules
  // the next round itself while there is still something to wait for.
  const advanceKyc = async (ctx, { manual = false } = {}) => {
    if (kycCtxRef.current !== ctx || ctx.busy) return;
    if (!sameAddress(accountRef.current, ctx.wallet)) {
      abandonKyc(ctx);
      return;
    }
    ctx.busy = true;
    try {
      if (ctx.phase === "status") {
        if (!manual && Date.now() - ctx.startedAt > KYC_MAX_WAIT_MS) {
          failKyc(ctx, "expired", "Stopped waiting for QIE Pass after 30 minutes. Start again when you're ready.");
          return;
        }
        const res = await fetch(`${SERVER_URL}/qiepass/status/${encodeURIComponent(ctx.requestId)}`);
        const data = await readJson(res);
        if (!isLiveFlow(ctx)) return;
        if (!res.ok || !data.success) {
          // A 4xx other than rate limiting won't fix itself by asking again.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            failKyc(ctx, "error", data.error || "Could not check the QIE Pass request.");
          }
          return;
        }
        if (data.status === "consent_given") {
          // QIE documents consent_given as the signal to claim. `ready` is an
          // extra that may never arrive, so allow it one more round, then claim.
          const ready = data.ready === true || data.vcMetadata?.ready === true;
          if (ready || manual || ctx.notReady >= 1) await startClaim(ctx);
          else ctx.notReady += 1;
        } else if (KYC_TERMINAL[data.status]) {
          failKyc(ctx, KYC_TERMINAL[data.status].status, KYC_TERMINAL[data.status].error);
        } else if (data.status === "pending_consent" && ctx.lastStatus !== "pending_consent") {
          ctx.lastStatus = "pending_consent";
          setKycState((prev) => ({ ...prev, status: "pending_consent" }));
          showKycStep(ctx, "Approve the request in QIE Wallet");
        }
      } else if (ctx.phase === "claiming" || ctx.phase === "onchain") {
        if (manual && ctx.parked) {
          ctx.parked = false;
          ctx.phaseSince = Date.now();
          showKycStep(ctx, "Waiting for the on-chain record");
        }
        if (!manual && Date.now() - ctx.phaseSince > CLAIM_MAX_WAIT_MS) {
          if (ctx.phase === "claiming") {
            failKyc(ctx, "error", "Couldn't reach the server to finish QIE Pass verification. Try again in a few minutes.");
          } else {
            // Stop polling but keep the request, so "Check again" can pick it up.
            ctx.parked = true;
            const message = "Still not recorded on-chain. Check again in a few minutes.";
            setKycState((prev) => ({ ...prev, message }));
            setTxState((prev) => ({ ...prev, status: "error", title: "Not recorded on-chain yet", error: message }));
          }
          return;
        }
        await settleClaim(ctx);
      }
    } catch (err) {
      console.warn("QIE Pass check failed:", err.message);
    } finally {
      ctx.busy = false;
      if (kycCtxRef.current === ctx && !ctx.parked) {
        scheduleKyc(ctx, ctx.phase === "status" ? KYC_POLL_MS : CLAIM_RETRY_MS);
      }
    }
  };

  // Start (or restart) verification for the connected wallet.
  const startKycVerification = async () => {
    if (!account) {
      setError("Connect wallet first");
      return;
    }
    stopKycFlow();
    const ctx = {
      wallet: account, requestId: null, phase: "starting", startedAt: Date.now(), phaseSince: 0,
      notReady: 0, lastStatus: null, busy: false, parked: false
    };
    kycCtxRef.current = ctx;
    setError("");
    setKycState({ ...IDLE_KYC, status: "creating", account: ctx.wallet });
    setTxState({ status: "preparing", action: "Starting QIE Pass verification", hash: "", error: "", qiePassFlow: ctx });

    try {
      if (!SERVER_URL) throw new Error("Backend server not available. QIE Pass verification requires the server to be running.");

      // Nothing to do when the adapter already has this wallet.
      if (await readQiePassVerified(ctx.wallet).catch(() => false)) {
        if (!isLiveFlow(ctx)) return;
        stopKycFlow();
        recordPassState(ctx.wallet, true);
        setKycState(IDLE_KYC);
        setTxState({
          status: "confirmed", action: "QIE Pass verified", hash: "", error: "",
          title: "QIE Pass verified", note: "This wallet is already verified on-chain."
        });
        return;
      }

      const res = await fetch(`${SERVER_URL}/qiepass/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: ctx.wallet })
      });
      const data = await readJson(res);
      if (!isLiveFlow(ctx)) return;
      if (!res.ok || !data.success) throw new Error(data.error || "Could not start QIE Pass verification.");
      if (!data.requestId) throw new Error("QIE Pass did not return a request. Try again.");
      ctx.requestId = data.requestId;
      ctx.phase = "status";
      ctx.lastStatus = data.status;
      setKycState((prev) => ({ ...prev, requestId: data.requestId }));

      if (data.status === "pending_kyc") {
        const redirectUrl = data.redirectUrl?.startsWith("http")
          ? data.redirectUrl
          : `https://qiepass.qie.digital${data.redirectUrl || ""}`;
        setKycState((prev) => ({ ...prev, status: "pending_kyc", redirectUrl }));
        showKycStep(ctx, "Finish verification in the QIE Pass tab");
        // Can be popup-blocked after the awaits above, so the panels also link to it.
        window.open(redirectUrl, "_blank");
        scheduleKyc(ctx, KYC_POLL_MS);
      } else if (data.status === "pending_consent") {
        setKycState((prev) => ({ ...prev, status: "pending_consent" }));
        showKycStep(ctx, "Approve the request in QIE Wallet");
        scheduleKyc(ctx, KYC_POLL_MS);
      } else if (data.status === "consent_given") {
        await startClaim(ctx);
        if (kycCtxRef.current === ctx) scheduleKyc(ctx, CLAIM_RETRY_MS);
      } else {
        const t = KYC_TERMINAL[data.status];
        failKyc(ctx, t ? t.status : "error",
          t ? t.error : `QIE Pass returned an unexpected status${data.status ? ` (${data.status})` : ""}.`);
      }
    } catch (err) {
      if (!isLiveFlow(ctx)) return;
      failKyc(ctx, "error", err.message);
      setError(err.message);
    }
  };

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      kycCtxRef.current = null;
      if (kycTimerRef.current) clearTimeout(kycTimerRef.current);
    };
  }, []);

  // "Check status" / "Check again": run one round of the current flow now.
  const checkKycStatus = async () => {
    const ctx = kycCtxRef.current;
    if (!ctx || !ctx.requestId || !SERVER_URL) return;
    await advanceKyc(ctx, { manual: true });
  };

  // Resolve QieDomain (.qie) - forward lookup via Explorer API
  // The QIE Domain Registry does not expose a public resolve function,
  // so we scan registration transactions (selector 0xf2101e95) to the registry
  // and find the one that registered the requested domain name.
  const resolveQieDomain = async (domainName) => {
    // Fast path: QIE's own registries expose resolver(string) -> (node, owner),
    // so this is one eth_call per registry. A name lives in exactly one of the
    // two, and the answer is the CURRENT owner - unlike the calldata scan below,
    // which returns whoever originally registered the name even after a transfer.
    try {
      const onChain = await resolveQieAddress(domainName, getReadProvider());
      if (onChain) return onChain;
    } catch (e) {
      console.warn("Onchain domain resolution failed, falling back:", e.message);
    }

    // Fallback: scan the legacy registry's registration calldata. Slow and
    // transfer-blind, but it still covers names the two registries do not answer for.
    const QIE_DOMAIN_REGISTRY = "0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed";
    const REGISTER_SELECTOR = "0xf2101e95";
    try {
      const explorerUrl = `https://mainnet.qie.digital/api?module=account&action=txlist&address=${QIE_DOMAIN_REGISTRY}&startblock=0&endblock=99999999&sort=desc`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(explorerUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      const txData = await resp.json();

      if (txData.status === "1" && txData.result) {
        for (const tx of txData.result) {
          if (
            tx.to?.toLowerCase() === QIE_DOMAIN_REGISTRY.toLowerCase() &&
            tx.input?.startsWith(REGISTER_SELECTOR) &&
            tx.isError === "0"
          ) {
            try {
              const params = "0x" + tx.input.slice(10);
              const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["string", "string[]", "string[]"],
                params
              );
              if (decoded[0].toLowerCase() === domainName.toLowerCase()) return tx.from;
            } catch (decodeErr) {
              // Skip malformed tx inputs
            }
          }
        }
      }
      console.warn("Domain not found in either registry or registry txs:", domainName);
      return ethers.ZeroAddress;
    } catch (err) {
      console.warn("Domain resolution fallback failed for", domainName, err.message);
      return ethers.ZeroAddress;
    }
  };


  // Generalized Swap (QIE ⇄ QUSDC) via Qiedex
  // Live quote for the swap panel. Deliberately mirrors swapQieForTokens: same
  // WQIE <-> qUSDC path, same read against the QieDex router (quotes are
  // read-only, so they skip FluenciRouter's attribution wrapper), same 5s cap
  // and 5% slippage, same mainnet-pinned provider and addresses. Returns null
  // rather than throwing so the UI can just show no quote when the pool is unreachable.
  const quoteSwap = async (fromToken, amount) => {
    try {
      if (!amount || Number(amount) <= 0) return null;
      const isReverse = fromToken === "QUSDC";
      const path = isReverse ? [MAINNET.qusdc, WQIE] : [WQIE, MAINNET.qusdc];

      const decimalsIn = isReverse ? 6 : 18;
      const decimalsOut = isReverse ? 18 : 6;
      const parsedAmount = ethers.parseUnits(String(amount), decimalsIn);

      const readDex = new ethers.Contract(MAINNET.qiedex, DEX_ABI, mainnetProvider());
      const amounts = await Promise.race([
        readDex.getAmountsOut(parsedAmount, path),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Quote timeout")), 5000))
      ]);

      const out = amounts[1];
      const amountOut = ethers.formatUnits(out, decimalsOut);
      const amountOutMin = ethers.formatUnits((out * 95n) / 100n, decimalsOut);
      const rate = Number(amountOut) / Number(amount);
      return { amountOut, amountOutMin, rate: String(rate) };
    } catch (e) {
      console.warn("quoteSwap failed:", e.message);
      return null;
    }
  };

  // opts.minOut (bigint, output-token base units): the swap must deliver at least
  // this much. The floor sent on-chain is max(95% of a fresh quote, minOut), so a
  // swap that would come up short reverts instead of under-delivering.
  const swapQieForTokens = async (fromToken, toToken, amount, opts = {}) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Swapping ${amount} ${fromToken} → ${toToken}`, hash: "", error: "" });
    try {
      // Sending a QIE-chain swap from another network would go to the wrong
      // contract (or fail with a confusing wallet error), so switch first.
      const wallet = activeProviderRef.current || window.ethereum;
      if (!wallet) throw new Error("No Web3 wallet detected");
      if (import.meta.env.DEV) console.warn("[swap] checking chain", { amount, fromToken, toToken });
      if (Number(await wallet.request({ method: "eth_chainId" })) !== 1990) {
        const switched = await switchToQieMainnet();
        if (!switched || Number(await wallet.request({ method: "eth_chainId" })) !== 1990) {
          throw new Error("Switch your wallet to QIE Mainnet to swap.");
        }
      }

      // From here on everything is mainnet by construction. chainId in state, and
      // so getReadProvider() and `contracts`, still describe the network the wallet
      // was on when this closure was created - wrong right after the switch above.
      const readProvider = mainnetProvider();
      const isReverse = fromToken === "QUSDC";
      const path = isReverse ? [MAINNET.qusdc, WQIE] : [WQIE, MAINNET.qusdc];

      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min deadline

      const decimalsIn = isReverse ? 6 : 18;
      const parsedAmount = ethers.parseUnits(String(amount), decimalsIn);
      const minOut = opts?.minOut !== undefined && opts?.minOut !== null ? BigInt(opts.minOut) : 0n;

      // Use FluenciRouter for swap execution (falls back to qiedex if router not set)
      const swapTarget = MAINNET.fluenciRouter || MAINNET.qiedex;

      // Fresh quote from QieDex directly (read-only, no attribution needed). No
      // quote means no swap: sending with amountOutMin = 0 has no slippage floor.
      const quoteFloor = async () => {
        let out = 0n;
        try {
          const readDex = new ethers.Contract(MAINNET.qiedex, DEX_ABI, readProvider);
          const amounts = await Promise.race([
            readDex.getAmountsOut(parsedAmount, path),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Quote timeout")), 5000))
          ]);
          out = amounts[amounts.length - 1];
        } catch (e) {
          console.warn("Failed to fetch getAmountsOut:", e.message);
        }
        if (!out || out <= 0n) throw new Error("Couldn't get a swap price, so the swap wasn't sent. Try again.");
        if (out < minOut) throw new Error("The price moved - this swap would return less than needed. Try again.");
        const floor = (out * 95n) / 100n; // 5% slippage
        return floor > minOut ? floor : minOut;
      };

      let amountOutMin = await quoteFloor();

      const injected = activeProviderRef.current || window.ethereum;
      if (!injected) throw new Error("No Web3 wallet detected");

      // Auto-approve QUSDC if we are doing a reverse swap (QUSDC ➔ QIE)
      if (isReverse) {
        setTxState({ status: "preparing", action: "Checking QUSDC Allowance...", hash: "", error: "" });
        const qusdcContract = new ethers.Contract(MAINNET.qusdc, ERC20_ABI, readProvider);
        const allowance = await qusdcContract.allowance(account, swapTarget);

        if (allowance < parsedAmount) {
          setTxState({ status: "preparing", action: "Approving QUSDC for Swap", hash: "", error: "" });
          setTxStep("awaiting_signature");
          const approveTx = await executeDirectTx(
            MAINNET.qusdc,
            ERC20_ABI,
            "approve",
            [swapTarget, ethers.MaxUint256],
            "0x0",
            100000n
          );
          setTxStep("broadcasting", { hash: approveTx.hash });
          setTxStep("confirming");
          await waitForTx(approveTx, readProvider);
          // The approval can take a while; don't swap on the price from before it.
          amountOutMin = await quoteFloor();
        }
      }

      setTxState({ status: "preparing", action: `Swapping ${amount} ${fromToken} → ${toToken}`, hash: "", error: "" });
      setTxStep("awaiting_signature");

      let tx;
      if (!isReverse) {
        // QIE ➔ QUSDC
        const dexInterface = new ethers.Interface(DEX_ABI);
        const data = dexInterface.encodeFunctionData("swapExactETHForTokens", [
          amountOutMin,
          path,
          account,
          deadline
        ]);
        const valueHex = "0x" + parsedAmount.toString(16);
        const gasHex = "0x" + (300000n).toString(16);

        if (import.meta.env.DEV) console.warn("[swap] asking wallet to sign", { to: swapTarget, value: valueHex });
        const txHash = await injected.request({
          method: "eth_sendTransaction",
          params: [{
            from: account,
            to: swapTarget,
            data: data,
            value: valueHex,
            gas: gasHex
          }]
        });
        if (!txHash) throw new Error("No transaction hash returned from wallet");
        if (import.meta.env.DEV) console.warn("[swap] signed", txHash);
        tx = { hash: txHash };
      } else {
        // QUSDC ➔ QIE
        tx = await executeDirectTx(
          swapTarget,
          DEX_ABI,
          "swapExactTokensForETH",
          [parsedAmount, amountOutMin, path, account, deadline],
          "0x0",
          300000n
        );
      }

      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx, readProvider);
      setTxStep("confirmed");

      // Send swap telemetry to backend asynchronously
      try {
        if (SERVER_URL) fetch(`${SERVER_URL}/swap-telemetry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: tx.hash })
        }).catch(err => console.warn("Failed to post swap telemetry:", err));
      } catch (telemetryErr) {
        console.warn("Failed to send swap telemetry:", telemetryErr);
      }

      await fetchAccountState();
      setLoading(false);
      return true;
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[swap] failed", { code: err?.code, message: err?.message, data: err?.data });
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
      // Callers chaining swap -> subscribe need to know the swap failed.
      return false;
    }
  };

  // Create stream NFT
  const createSubscription = async (merchant, tokenSymbol, ratePerSecond, cliffSeconds = 0, stopSeconds = 0) => {
    if (V3_WRITES_FROZEN) {
      setError(V3_FROZEN.create);
      return;
    }
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Creating Subscription Stream", hash: "", error: "" });
    try {
      // Resolve domain if inputs end with .qie
      let merchantAddress = merchant;
      if (merchant.endsWith(".qie")) {
        const resolved = await resolveQieDomain(merchant);
        if (resolved === ethers.ZeroAddress || resolved === "0x0000000000000000000000000000000000000000") {
          throw new Error("Could not resolve Qie Domain name.");
        }
        merchantAddress = resolved;
      }

      const tokenAddress = contracts.qusdc;
      
      // Calculate absolute timestamps
      const provider = getReadProvider();
      const block = await provider.getBlock("latest");
      const currentTimestamp = block.timestamp;
      
      const cliffTime = cliffSeconds > 0 ? currentTimestamp + Number(cliffSeconds) : 0;
      const stopTime = stopSeconds > 0 ? currentTimestamp + Number(stopSeconds) : 0;

      // Smart auto-approval: check allowance and top up if needed
      const qusdcContract = new ethers.Contract(tokenAddress, ERC20_ABI, getReadProvider());
      const currentAllowance = await qusdcContract.allowance(account, contracts.registry);
      // Estimate needed: rate * 1 hour (generous buffer) or rate * stopTime
      const estimatedNeed = stopSeconds > 0
        ? BigInt(ratePerSecond) * BigInt(stopSeconds) * 2n  // 2x buffer
        : BigInt(ratePerSecond) * 3600n;  // 1 hour buffer
      
      if (currentAllowance < estimatedNeed) {
        setTxState({ status: "preparing", action: "Approving QUSDC for this stream...", hash: "", error: "" });
        setTxStep("awaiting_signature");
        const approveAmount = estimatedNeed > ethers.parseUnits("10000", 6) ? estimatedNeed : ethers.parseUnits("10000", 6);
        const approveTx = await executeDirectTx(
          contracts.qusdc,
          ERC20_ABI,
          "approve",
          [contracts.registry, approveAmount],
          "0x0",
          100000n
        );
        setTxStep("broadcasting", { hash: approveTx.hash });
        setTxStep("confirming");
        await waitForTx(approveTx);
        setTxState({ status: "preparing", action: "Creating Subscription Stream", hash: "", error: "" });
      }

      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "createSubscription",
        [merchantAddress, tokenAddress, ratePerSecond, cliffTime, stopTime],
        "0x0",
        500000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Claim stream funds
  const claimStream = async (subId) => {
    if (V3_WRITES_FROZEN) {
      setError(V3_FROZEN.claim);
      return;
    }
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Claiming Stream Funds", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "claimStream",
        [subId],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Open Dispute (Option A)
  const openDispute = async (subId) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Opening Dispute", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "openDispute",
        [subId],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Resolve Dispute (Option A)
  const resolveDisputeOnChain = async (subId, subscriberRefund, merchantShare, signature) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Resolving Dispute", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "resolveDispute",
        [subId, subscriberRefund, merchantShare, signature],
        "0x0",
        300000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Transfer NFT Subscription (Option B)
  const transferStreamNFT = async (subId, toAddress) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Transferring Stream NFT", hash: "", error: "" });
    try {
      const tokenId = BigInt(subId);
      let recipient = toAddress;
      if (toAddress.endsWith(".qie")) {
        const resolved = await resolveQieDomain(toAddress);
        if (resolved === ethers.ZeroAddress) {
          throw new Error("Could not resolve Qie Domain for recipient.");
        }
        recipient = resolved;
      }

      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "transferFrom",
        [account, recipient, tokenId],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Resume paused stream
  const resumeStream = async (subId) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Resuming Stream", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "resumeStream",
        [subId],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // Terminate active stream
  const terminateStream = async (subId) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Terminating Stream", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.registry,
        REGISTRY_ABI,
        "terminateStream",
        [subId],
        "0x0",
        200000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  const wcProviderRef = useRef(null);

  const connectWalletConnect = async (onUri) => {
    setError("");
    setLoading(true);
    try {
      // Disconnect and clean up any existing provider first to ensure a clean state
      if (wcProviderRef.current) {
        try {
          await wcProviderRef.current.disconnect();
        } catch (e) {}
        wcProviderRef.current = null;
      }

      // Clear WalletConnect localStorage keys to force a fresh pairing URI
      try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith("wc@2:") || key.startsWith("walletconnect")) {
            localStorage.removeItem(key);
          }
        });
        console.log("Cleared WalletConnect pairing cache");
      } catch (e) {
        console.warn("Failed to clear localStorage:", e);
      }

      // Initialize a fresh provider, using .com relay (different routing than .org)
      const wcProvider = await EthereumProvider.init({
        projectId: "8801909e023fe9d1391c107d4f7f0443",
        optionalChains: [1990, 1],
        showQrModal: false,
        relayUrl: "wss://relay.walletconnect.com",
        metadata: {
          name: "Fluenci",
          description: "AI-Shielded Real-Time Streaming Payments",
          url: window.location.origin,
          icons: []
        },
        rpcMap: {
          1: "https://eth.llamarpc.com",
          1990: "https://rpc1mainnet.qie.digital"
        }
      });
      wcProviderRef.current = wcProvider;

      let uriReceived = false;

      // Attach URI listener BEFORE calling connect
      wcProvider.on("display_uri", (uri) => {
        console.log("WalletConnect URI received:", uri?.substring(0, 50));
        uriReceived = true;
        clearTimeout(uriTimeout);
        if (onUri) onUri(uri);
      });

      // Timeout fallback: if no URI in 8s, network is blocking the relay
      const uriTimeout = setTimeout(async () => {
        if (!uriReceived) {
          console.warn("WalletConnect URI timeout - relay likely blocked by network");
          if (onUri) onUri(null);
          setError("Network is blocking WalletConnect relay. Please use a VPN or try on a different Wi-Fi network.");
          setLoading(false);
          try { await wcProvider.disconnect(); } catch (e) {}
        }
      }, 8000);

      // Start connection (this triggers display_uri)
      wcProvider.connect()
        .then(() => {
          clearTimeout(uriTimeout);
          if (uriReceived) finalizeWalletConnect(wcProvider);
        })
        .catch(async (err) => {
          clearTimeout(uriTimeout);
          console.warn("WalletConnect connect error:", err.message);
          if (!uriReceived) {
            setError("WalletConnect relay blocked. Try a VPN or different network.");
            if (onUri) onUri(null);
          }
          setLoading(false);
          try { await wcProvider.disconnect(); } catch (e) {}
        });

    } catch (err) {
      console.error("WalletConnect init error:", err);
      setError("Failed to initialize WalletConnect: " + err.message);
      setLoading(false);
    }
  };

  const finalizeWalletConnect = async (wcProvider) => {
    try {
      const accounts = wcProvider.accounts;
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned from WalletConnect");
      }

      const address = accounts[0];
      setAccount(address);
      activeProviderRef.current = wcProvider;

      const provider = new ethers.BrowserProvider(wcProvider);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      // Listen for disconnect
      wcProvider.on("disconnect", () => {
        disconnectWallet();
      });

      wcProvider.on("accountsChanged", (accs) => {
        if (accs.length > 0) setAccount(accs[0]);
        else disconnectWallet();
      });

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    setAccount("");
    setAccountDomain("");
    setChainId(0);
    activeProviderRef.current = null;
    setError("");
    // Disconnect WalletConnect session if active
    if (wcProviderRef.current) {
      try { wcProviderRef.current.disconnect(); } catch (e) {}
      wcProviderRef.current = null;
    }
  };

  const registerQieDomain = async (domainName) => {
    if (!account) return;
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Registering QieDomain: ${domainName}`, hash: "", error: "" });
    try {
      if (!contracts.qiedomain) throw new Error("QieDomain contract not configured");
      
      const cleanDomain = domainName.endsWith(".qie") ? domainName : `${domainName}.qie`;
      
      setTxStep("awaiting_signature");
      const tx = await executeDirectTx(
        contracts.qiedomain,
        DOMAIN_ABI,
        "registerDomain",
        [cleanDomain, account],
        "0x0",
        150000n
      );
      setTxStep("broadcasting", { hash: tx.hash });
      setTxStep("confirming");
      await waitForTx(tx);
      setTxStep("confirmed");
      setAccountDomain(cleanDomain);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setTxStep("error", { error: err.message });
      setLoading(false);
    }
  };

  // EIP-6963 provider announcement discovery
  useEffect(() => {
    const handleAnnounce = (event) => {
      setAnnouncedProviders((prev) => {
        if (prev.some((p) => p.info.uuid === event.detail.info.uuid)) {
          return prev;
        }
        return [...prev, event.detail];
      });
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounce);
    };
  }, []);

  // Setup account changed listeners on active provider
  useEffect(() => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected || !injected.on) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      } else {
        setAccount("");
        setAccountDomain("");
      }
    };
    const handleChainChanged = (chainHex) => {
      setChainId(Number(chainHex));
    };

    injected.on("accountsChanged", handleAccountsChanged);
    injected.on("chainChanged", handleChainChanged);

    return () => {
      if (injected.removeListener) {
        injected.removeListener("accountsChanged", handleAccountsChanged);
        injected.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, [account]);

  // Poll state and subscriptions
  useEffect(() => {
    if (account) {
      fetchAccountState();
      fetchSubscriptions();

      const interval = setInterval(() => {
        fetchAccountState();
        fetchSubscriptions();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [account, fetchAccountState, fetchSubscriptions]);

  // Animated tickers
  const requestRef = useRef();
  const animate = useCallback(() => {
    const now = Date.now();
    
    setRealtimeClaimables((prev) => {
      const next = { ...prev };
      let updated = false;

      const allStreams = [...subscriberStreams, ...merchantStreams];
      allStreams.forEach((stream) => {
        const isUSDC = stream.tokenSymbol === "QUSDC";
        const scalar = isUSDC ? 6 : 18;
        
        if (stream.active && !stream.pausedByAI && stream.disputeState === 0) {
          const currentUnix = Math.floor(now / 1000);
          
          // Respect cliff time
          if (stream.cliffTime > 0 && currentUnix < stream.cliffTime) {
            next[stream.id] = 0;
            updated = true;
            return;
          }

          let claimEnd = currentUnix;
          if (stream.stopTime > 0 && claimEnd > stream.stopTime) {
            claimEnd = stream.stopTime;
          }

          const elapsed = claimEnd - stream.lastClaimedTimestamp;
          if (elapsed > 0) {
            const claimable = (elapsed * stream.ratePerSecond) / (10 ** scalar);
            const subsecondFraction = ((now % 1000) / 1000) * (stream.ratePerSecond / (10 ** scalar));
            const smoothClaimable = claimable + subsecondFraction;
            
            // Only update if value increased (prevents jitter from blockchain poll race)
            const prevValue = prev[stream.id] || 0;
            const finalValue = smoothClaimable >= prevValue ? smoothClaimable : prevValue;
            
            if (next[stream.id] !== finalValue) {
              next[stream.id] = finalValue;
              updated = true;
            }
          } else {
            next[stream.id] = 0;
            updated = true;
          }
        } else if (stream.pausedByAI || stream.disputeState > 0) {
          // Freeze accumulator while paused/disputed
          next[stream.id] = (Math.max(0, stream.lastClaimedTimestamp - stream.startTime) * stream.ratePerSecond) / (10 ** scalar);
          updated = true;
        } else {
          next[stream.id] = 0;
          updated = true;
        }
      });

      return updated ? next : prev;
    });
  }, [subscriberStreams, merchantStreams]);

  useEffect(() => {
    const tick = () => {
      animate();
      requestRef.current = requestAnimationFrame(tick);
    };
    requestRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  return {
    account,
    chainId,
    qieBalance,
    qusdcBalance,
    qusdcAllowance,
    qiePassVerified,
    accountDomain,
    announcedProviders,
    subscriberStreams,
    merchantStreams,
    realtimeClaimables,
    loading,
    error,
    clearError,
    txState,
    resetTx,
    contracts,
    connectWallet,
    connectWalletConnect,
    finalizeWalletConnect,
    disconnectWallet,
    registerQieDomain,
    approveToken,
    toggleQiePassStatus: startKycVerification,
    startKycVerification,
    checkKycStatus,
    kycState,
    resolveQieDomain,
    swapQieForTokens,
    quoteSwap,
    createSubscription,
    claimStream,
    openDispute,
    resolveDisputeOnChain,
    transferStreamNFT,
    resumeStream,
    terminateStream,
    updateContractAddresses,
    switchToQieMainnet,
    getActiveProvider,
    refreshData: () => {
      fetchAccountState();
      fetchSubscriptions();
    }
  };
}
