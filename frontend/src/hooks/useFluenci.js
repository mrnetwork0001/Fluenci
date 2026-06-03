import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

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
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"
];

const DOMAIN_ABI = [
  "function registerDomain(string calldata domain, address owner) external",
  "function resolveDomain(string calldata domain) external view returns (address)",
  "function lookupAddress(address addr) external view returns (string memory)"
];

const CONTRACT_ADDRESSES_BY_CHAIN = {
  1990: { // QIE Mainnet
    registry: "0x0d21623aF12FF88B8ad12d2831e1FA715A0A7675",
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", // Official QUSDC
    qiepass: "0x0766Ff824376CEf38CFa5C155A51E90578096e38",
    auditor: "0x80b33a1A6625c394Df501991d4Cee0eA780A6C3d",
    qiedex: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef", // Official QIEDex Router
    qiedomain: "0xD0B0432395B2f414A4d9B74BD51523687a02883c"
  }
};

export function useFluenci() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [qieBalance, setQieBalance] = useState("0");
  
  // Token states
  const [qusdcBalance, setQusdcBalance] = useState("0");
  const [qusdcAllowance, setQusdcAllowance] = useState("0");

  const [qiePassVerified, setQiePassVerified] = useState(false);
  const [accountDomain, setAccountDomain] = useState("");
  const [announcedProviders, setAnnouncedProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // QIE Pass KYC state
  const [kycState, setKycState] = useState({
    status: "idle", // idle | creating | pending_kyc | pending_consent | claiming | verified | error
    requestId: null,
    redirectUrl: null,
    error: null
  });
  const kycPollRef = useRef(null);

  // Transaction modal state
  const [txState, setTxState] = useState({
    status: "idle", // idle | preparing | awaiting_signature | broadcasting | confirming | confirmed | error
    action: "",
    hash: "",
    error: ""
  });

  const setTxStep = (status, extra = {}) => {
    setTxState(prev => ({ ...prev, status, ...extra }));
  };

  const resetTx = () => {
    setTxState({ status: "idle", action: "", hash: "", error: "" });
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
    qiedomain: ""
  });

  // Automatically update contract addresses based on connected network chainId
  useEffect(() => {
    const config = CONTRACT_ADDRESSES_BY_CHAIN[chainId] || CONTRACT_ADDRESSES_BY_CHAIN[1990];
    setContracts(config);
  }, [chainId]);

  const updateContractAddresses = (newConfig) => {
    setContracts((prev) => ({ ...prev, ...newConfig }));
  };

  const activeProviderRef = useRef(null);

  const getProviderAndSigner = async () => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected) throw new Error("No Web3 wallet detected");
    const provider = new ethers.BrowserProvider(injected);
    const signer = await provider.getSigner();
    return { provider, signer };
  };

  const getReadProvider = useCallback(() => {
    return new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
  }, []);

  // Wait for a transaction using our own read provider (bypasses wallet's potentially broken RPC)
  const waitForTx = async (tx) => {
    const readProvider = getReadProvider();
    const TIMEOUT_MS = 120000; // 2 minute safety timeout
    const receipt = await Promise.race([
      readProvider.waitForTransaction(tx.hash, 1),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(
          `Transaction sent (${tx.hash.slice(0, 10)}…) but confirmation timed out after 2 minutes. ` +
          `Check your wallet or block explorer for status.`
        )), TIMEOUT_MS)
      )
    ]);
    return receipt;
  };

  // Switch network to QIE Mainnet and force RPC sync
  const switchToQieMainnet = async () => {
    const injected = activeProviderRef.current || window.ethereum;
    if (!injected) return;
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
      setError("");
    } catch (err) {
      console.error("Failed to add or sync QIE Mainnet network", err);
      setError("Failed to add or sync QIE Mainnet. Please check MetaMask.");
    }
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
        if (!window.ethereum) {
          throw new Error("Please install MetaMask or Qie Wallet to interact with Fluenci");
        }
        targetProvider = window.ethereum;
        activeProviderRef.current = window.ethereum;
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

    try {
      const provider = getReadProvider();
      
      // Native QIE Balance
      const qieBalVal = await provider.getBalance(account);
      setQieBalance(ethers.formatEther(qieBalVal));

      // Fetch qUSDC Balance & Allowance
      if (contracts.qusdc) {
        const qusdcContract = new ethers.Contract(contracts.qusdc, ERC20_ABI, provider);
        const bal = await qusdcContract.balanceOf(account);
        setQusdcBalance(ethers.formatUnits(bal, 6));

        if (contracts.registry) {
          const allow = await qusdcContract.allowance(account, contracts.registry);
          setQusdcAllowance(ethers.formatUnits(allow, 6));
        }
      }

      // Fetch QIE Pass KYC Status
      if (contracts.qiepass) {
        try {
          const passContract = new ethers.Contract(contracts.qiepass, QIEPASS_ABI, provider);
          const isVerified = await passContract.verifyIdentity(account);
          setQiePassVerified(isVerified);
        } catch (err) {
          console.warn("Failed to fetch QIE Pass status, defaulting to unverified:", err.message);
          setQiePassVerified(false);
        }
      }

      // Fetch Connected Account's .qie Domain Name
      if (contracts.qiedomain) {
        try {
          const domainContract = new ethers.Contract(contracts.qiedomain, DOMAIN_ABI, provider);
          const domain = await domainContract.lookupAddress(account);
          if (domain && domain !== "") {
            setAccountDomain(domain);
          } else {
            setAccountDomain("");
          }
        } catch (err) {
          console.warn("Reverse domain lookup failed for", account);
          setAccountDomain("");
        }
      } else {
        setAccountDomain("");
      }
    } catch (err) {
      console.error("Failed to fetch account state", err);
    }
  }, [account, contracts]);

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
            tokenSymbol: isUSDC ? "qUSDC" : "Unknown",
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
            tokenSymbol: isUSDC ? "qUSDC" : "Unknown",
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

  // Mint mock stablecoins / WETH
  const mintMockTokens = async (tokenSymbol, amount) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Minting ${amount} ${tokenSymbol}`, hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      const decimals = tokenSymbol === "qUSDC" ? 6 : 18;
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await tokenContract.mint(account, ethers.parseUnits(amount, decimals));
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

  // Approve Tokens
  const approveToken = async (tokenSymbol) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Approving qUSDC`, hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const tokenAddress = contracts.qusdc;
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await tokenContract.approve(contracts.registry, ethers.MaxUint256, { gasLimit: 100000n });
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
  // QIE PASS REAL KYC VERIFICATION
  // ==========================================

  const SERVER_URL = "http://localhost:5001";

  // Step 1: Start KYC verification
  const startKycVerification = async () => {
    if (!account) {
      setError("Connect wallet first");
      return;
    }
    setError("");
    setKycState({ status: "creating", requestId: null, redirectUrl: null, error: null });

    try {
      const res = await fetch(`${SERVER_URL}/qiepass/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account })
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create verification request");
      }

      if (data.status === "pending_kyc") {
        // User needs to complete KYC — open redirect in new tab
        const redirectUrl = data.redirectUrl?.startsWith("http")
          ? data.redirectUrl
          : `https://qiepass.qie.digital${data.redirectUrl}`;
        setKycState({
          status: "pending_kyc",
          requestId: data.requestId,
          redirectUrl,
          error: null
        });
        window.open(redirectUrl, "_blank");
        // Start polling
        startKycPolling(data.requestId);
      } else if (data.status === "pending_consent") {
        // User already verified, waiting for consent
        setKycState({
          status: "pending_consent",
          requestId: data.requestId,
          redirectUrl: null,
          error: null
        });
        startKycPolling(data.requestId);
      } else if (data.status === "consent_given") {
        // Ready to claim
        await claimKyc(data.requestId);
      }
    } catch (err) {
      setKycState(prev => ({ ...prev, status: "error", error: err.message }));
      setError(err.message);
    }
  };

  // Step 2: Poll for status changes
  const startKycPolling = (requestId) => {
    // Clear any existing poll
    if (kycPollRef.current) {
      clearInterval(kycPollRef.current);
    }

    kycPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/qiepass/status/${requestId}`);
        const data = await res.json();

        if (!data.success) return;

        if (data.status === "consent_given" && data.vcMetadata?.ready) {
          clearInterval(kycPollRef.current);
          kycPollRef.current = null;
          setKycState(prev => ({ ...prev, status: "claiming" }));
          await claimKyc(requestId);
        } else if (data.status === "consent_rejected") {
          clearInterval(kycPollRef.current);
          kycPollRef.current = null;
          setKycState(prev => ({ ...prev, status: "error", error: "User rejected consent" }));
        } else if (data.status === "pending_consent") {
          setKycState(prev => ({ ...prev, status: "pending_consent" }));
        }
      } catch (err) {
        console.warn("KYC poll error:", err.message);
      }
    }, 15000); // Poll every 15 seconds
  };

  // Step 3: Claim verified credentials
  const claimKyc = async (requestId) => {
    try {
      setKycState(prev => ({ ...prev, status: "claiming" }));
      const res = await fetch(`${SERVER_URL}/qiepass/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, walletAddress: account })
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to claim credentials");
      }

      setQiePassVerified(true);
      setKycState({
        status: "verified",
        requestId,
        redirectUrl: null,
        error: null
      });
      await fetchAccountState();
    } catch (err) {
      setKycState(prev => ({ ...prev, status: "error", error: err.message }));
      setError(err.message);
    }
  };

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (kycPollRef.current) {
        clearInterval(kycPollRef.current);
      }
    };
  }, []);

  // Manual poll trigger for "Check Status" button
  const checkKycStatus = async () => {
    if (!kycState.requestId) return;
    try {
      const res = await fetch(`${SERVER_URL}/qiepass/status/${kycState.requestId}`);
      const data = await res.json();
      if (data.success && data.status === "consent_given" && data.vcMetadata?.ready) {
        await claimKyc(kycState.requestId);
      } else if (data.success) {
        setKycState(prev => ({ ...prev, status: data.status }));
      }
    } catch (err) {
      console.warn("Manual KYC check error:", err.message);
    }
  };

  // Resolve QieDomain (.qie)
  const resolveQieDomain = async (domainName) => {
    if (!contracts.qiedomain) return ethers.ZeroAddress;
    try {
      const provider = getReadProvider();
      const domainContract = new ethers.Contract(contracts.qiedomain, DOMAIN_ABI, provider);
      const res = await domainContract.resolveDomain(domainName);
      return res;
    } catch (err) {
      console.warn("Domain resolution failed for", domainName);
      return ethers.ZeroAddress;
    }
  };

  // Swap native QIE via Qiedex
  const swapQieForTokens = async (tokenSymbol, qieAmount) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: `Swapping ${qieAmount} QIE → qUSDC`, hash: "", error: "" });
    try {
      const path = [
        "0x0087904D95BEe9E5F24dc8852804b547981A9139", // WQIE
        contracts.qusdc // QUSDC
      ];
      
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 min deadline
      
      // Fetch quote via direct read provider (bypasses wallet RPC which can hang)
      let amountOutMin = 0n;
      try {
        const readProvider = getReadProvider();
        const readDex = new ethers.Contract(contracts.qiedex, DEX_ABI, readProvider);
        const amounts = await Promise.race([
          readDex.getAmountsOut(ethers.parseEther(qieAmount), path),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Quote timeout")), 5000))
        ]);
        amountOutMin = (amounts[1] * 95n) / 100n; // 5% slippage
      } catch (e) {
        console.warn("Failed to fetch getAmountsOut, proceeding with 0 min:", e.message);
      }

      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const dexContract = new ethers.Contract(contracts.qiedex, DEX_ABI, signer);

      const tx = await dexContract.swapExactETHForTokens(
        amountOutMin,
        path,
        account,
        deadline,
        {
          value: ethers.parseEther(qieAmount),
          gasLimit: 300000n
        }
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

  // Create stream NFT
  const createSubscription = async (merchant, tokenSymbol, ratePerSecond, cliffSeconds = 0, stopSeconds = 0) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Creating Subscription Stream", hash: "", error: "" });
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);

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

      setTxStep("awaiting_signature");
      const tx = await registryContract.createSubscription(
        merchantAddress,
        tokenAddress,
        ratePerSecond,
        cliffTime,
        stopTime,
        { gasLimit: 500000n }
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
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: "Claiming Stream Funds", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.claimStream(subId, { gasLimit: 200000n });
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
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.openDispute(subId, { gasLimit: 200000n });
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
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.resolveDispute(subId, subscriberRefund, merchantShare, signature, { gasLimit: 300000n });
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
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
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
      const tx = await registryContract.transferFrom(account, recipient, tokenId, { gasLimit: 200000n });
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
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.resumeStream(subId, { gasLimit: 200000n });
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
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.terminateStream(subId, { gasLimit: 200000n });
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
        const isUSDC = stream.tokenSymbol === "qUSDC";
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
            
            if (next[stream.id] !== smoothClaimable) {
              next[stream.id] = smoothClaimable;
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

    requestRef.current = requestAnimationFrame(animate);
  }, [subscriberStreams, merchantStreams]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
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
    txState,
    resetTx,
    contracts,
    connectWallet,
    approveToken,
    toggleQiePassStatus: startKycVerification,
    startKycVerification,
    checkKycStatus,
    kycState,
    resolveQieDomain,
    swapQieForTokens,
    createSubscription,
    claimStream,
    openDispute,
    resolveDisputeOnChain,
    transferStreamNFT,
    resumeStream,
    terminateStream,
    updateContractAddresses,
    switchToQieMainnet,
    refreshData: () => {
      fetchAccountState();
      fetchSubscriptions();
    }
  };
}
