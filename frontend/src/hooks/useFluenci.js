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
  "function swapQieForTokens(address tokenAddress) external payable returns (uint256)",
  "function ratePerQie(address tokenAddress) external view returns (uint256)"
];

const DOMAIN_ABI = [
  "function registerDomain(string calldata domain, address owner) external",
  "function resolveDomain(string calldata domain) external view returns (address)",
  "function lookupAddress(address addr) external view returns (string memory)"
];

const CONTRACT_ADDRESSES_BY_CHAIN = {
  1983: { // QIE Testnet
    registry: "0x2DA9e917568D69626078df6bCb7B71F0DeDA6117",
    qusdc: "0xB64aE86dc64AEcB67a870192cDCAeC30EBd14b3b",
    weth: "0x45466425dc303c8c014885ACdEd3d95147eC4993",
    qiepass: "0x774758CE0Cb704AC54f1cc0cace59d2957d8250A",
    auditor: "0x75475647f52531D4086296415392E4AA94b92de7",
    qiedex: "0xE21F69c4394dFA41FC5F31a9B994e0275B47cD34",
    qiedomain: "0x5b66380309C29D00Ff82388a856fB5e87fF09A7E"
  },
  1990: { // QIE Mainnet
    registry: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    qusdc: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    weth: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    qiedex: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
    qiedomain: "0x9A676e781A523b5d0C0e43731313A708CB607508"
  }
};

export function useFluenci() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [qieBalance, setQieBalance] = useState("0");
  
  // Dual-token states
  const [qusdcBalance, setQusdcBalance] = useState("0");
  const [wethBalance, setWethBalance] = useState("0");
  const [qusdcAllowance, setQusdcAllowance] = useState("0");
  const [wethAllowance, setWethAllowance] = useState("0");

  const [qiePassVerified, setQiePassVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    weth: "",
    qiepass: "",
    auditor: "",
    qiedex: "",
    qiedomain: ""
  });

  // Automatically update contract addresses based on connected network chainId
  useEffect(() => {
    const config = CONTRACT_ADDRESSES_BY_CHAIN[chainId] || CONTRACT_ADDRESSES_BY_CHAIN[1983];
    setContracts(config);
  }, [chainId]);

  const updateContractAddresses = (newConfig) => {
    setContracts((prev) => ({ ...prev, ...newConfig }));
  };

  const getProviderAndSigner = async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return { provider, signer };
  };

  const getReadProvider = useCallback(() => {
    if (chainId === 1990) {
      return new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
    }
    return new ethers.JsonRpcProvider("https://rpc1testnet.qie.digital");
  }, [chainId]);

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

  // Switch network to QIE Testnet and force RPC sync
  const switchToQieTestnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x7BF",
          chainName: "QIE Testnet",
          nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
          rpcUrls: ["https://rpc1testnet.qie.digital"],
          blockExplorerUrls: ["https://testnet.qie.digital/"]
        }]
      });
      setError("");
    } catch (err) {
      console.error("Failed to add or sync QIE Testnet network", err);
      setError("Failed to add or sync QIE Testnet. Please check MetaMask.");
    }
  };

  // Switch network to QIE Mainnet and force RPC sync
  const switchToQieMainnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
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

  const connectWallet = async () => {
    setError("");
    setLoading(true);
    try {
      if (!window.ethereum) {
        throw new Error("Please install MetaMask or Qie Wallet to interact with Fluenci");
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      setAccount(address);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      // Automatic network check - warning banner will handle it rather than forcing a switch on connect
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

      // Fetch MockWETH Balance & Allowance
      if (contracts.weth) {
        const wethContract = new ethers.Contract(contracts.weth, ERC20_ABI, provider);
        const bal = await wethContract.balanceOf(account);
        setWethBalance(ethers.formatUnits(bal, 18));

        if (contracts.registry) {
          const allow = await wethContract.allowance(account, contracts.registry);
          setWethAllowance(ethers.formatUnits(allow, 18));
        }
      }

      // Fetch QIE Pass KYC Status
      if (contracts.qiepass) {
        const passContract = new ethers.Contract(contracts.qiepass, QIEPASS_ABI, provider);
        const isVerified = await passContract.verifyIdentity(account);
        setQiePassVerified(isVerified);
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
            tokenSymbol: isUSDC ? "qUSDC" : "MockWETH",
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
            tokenSymbol: isUSDC ? "qUSDC" : "MockWETH",
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
    setTxState({ status: "preparing", action: `Approving ${tokenSymbol}`, hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await tokenContract.approve(contracts.registry, ethers.MaxUint256);
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

  // Toggle QIE Pass Verification Status (Mock)
  const toggleQiePassStatus = async (status) => {
    setError("");
    setLoading(true);
    setTxState({ status: "preparing", action: status ? "Verifying KYC Identity" : "Revoking KYC Identity", hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const passContract = new ethers.Contract(contracts.qiepass, QIEPASS_ABI, signer);
      const tx = await passContract.registerIdentity(account, status);
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
    setTxState({ status: "preparing", action: `Swapping ${qieAmount} QIE → ${tokenSymbol}`, hash: "", error: "" });
    try {
      setTxStep("awaiting_signature");
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      const dexContract = new ethers.Contract(contracts.qiedex, DEX_ABI, signer);
      
      const tx = await dexContract.swapQieForTokens(tokenAddress, {
        value: ethers.parseEther(qieAmount)
      });
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

      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      
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
        stopTime
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
      const tx = await registryContract.claimStream(subId);
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
      const tx = await registryContract.openDispute(subId);
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
      const tx = await registryContract.resolveDispute(subId, subscriberRefund, merchantShare, signature);
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
      const tx = await registryContract.transferFrom(account, recipient, tokenId);
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
      const tx = await registryContract.resumeStream(subId);
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
      const tx = await registryContract.terminateStream(subId);
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

  // Setup account changed listeners
  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accounts) => {
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      } else {
        setAccount("");
      }
    };
    const handleChainChanged = (chainHex) => {
      setChainId(Number(chainHex));
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

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
    wethBalance,
    qusdcAllowance,
    wethAllowance,
    qiePassVerified,
    subscriberStreams,
    merchantStreams,
    realtimeClaimables,
    loading,
    error,
    txState,
    resetTx,
    contracts,
    connectWallet,
    mintMockTokens,
    approveToken,
    toggleQiePassStatus,
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
    switchToQieTestnet,
    switchToQieMainnet,
    refreshData: () => {
      fetchAccountState();
      fetchSubscriptions();
    }
  };
}
