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
    registry: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318", // Local/Testnet fallback
    qusdc: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    weth: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    qiedex: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
    qiedomain: "0x9A676e781A523b5d0C0e43731313A708CB607508"
  },
  31337: { // Localhost Hardhat
    registry: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    qusdc: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    weth: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    qiepass: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auditor: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    qiedex: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
    qiedomain: "0x9A676e781A523b5d0C0e43731313A708CB607508"
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

export function useQieFlow() {
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
    const config = CONTRACT_ADDRESSES_BY_CHAIN[chainId] || CONTRACT_ADDRESSES_BY_CHAIN[31337];
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

  // Switch network to QIE Testnet
  const switchToQieTestnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7BF" }] // 1983 in hex
      });
    } catch (err) {
      console.warn("Switch network failed, attempting to add QIE Testnet...", err);
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x7BF",
            chainName: "QIE Testnet",
            nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
            rpcUrls: ["https://rpc1testnet.qie.digital/"],
            blockExplorerUrls: ["https://testnet.qie.digital/"]
          }]
        });
      } catch (addErr) {
        console.error("Failed to add network", addErr);
        setError("Failed to automatically add QIE Testnet. Please check MetaMask.");
      }
    }
  };

  // Switch network to QIE Mainnet
  const switchToQieMainnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7C6" }] // 1990 in hex
      });
    } catch (err) {
      console.warn("Switch network failed, attempting to add QIE Mainnet...", err);
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
      } catch (addErr) {
        console.error("Failed to add network", addErr);
        setError("Failed to automatically add QIE Mainnet. Please check MetaMask.");
      }
    }
  };

  const connectWallet = async () => {
    setError("");
    setLoading(true);
    try {
      if (!window.ethereum) {
        throw new Error("Please install MetaMask or Qie Wallet to interact with QieFlow");
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      setAccount(address);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      // Trigger automatic network check
      if (Number(network.chainId) !== 1983 && Number(network.chainId) !== 31337) {
        await switchToQieTestnet();
      }

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
      const { provider } = await getProviderAndSigner();
      
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
      const { provider } = await getProviderAndSigner();
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
    try {
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      const decimals = tokenSymbol === "qUSDC" ? 6 : 18;
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await tokenContract.mint(account, ethers.parseUnits(amount, decimals));
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Approve Tokens
  const approveToken = async (tokenSymbol) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await tokenContract.approve(contracts.registry, ethers.MaxUint256);
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Toggle QIE Pass Verification Status (Mock)
  const toggleQiePassStatus = async (status) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const passContract = new ethers.Contract(contracts.qiepass, QIEPASS_ABI, signer);
      const tx = await passContract.registerIdentity(account, status);
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Resolve QieDomain (.qie)
  const resolveQieDomain = async (domainName) => {
    if (!contracts.qiedomain) return address(0);
    try {
      const { provider } = await getProviderAndSigner();
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
    try {
      const { signer } = await getProviderAndSigner();
      const tokenAddress = tokenSymbol === "qUSDC" ? contracts.qusdc : contracts.weth;
      const dexContract = new ethers.Contract(contracts.qiedex, DEX_ABI, signer);
      
      const tx = await dexContract.swapQieForTokens(tokenAddress, {
        value: ethers.parseEther(qieAmount)
      });
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Create stream NFT
  const createSubscription = async (merchant, tokenSymbol, ratePerSecond, cliffSeconds = 0, stopSeconds = 0) => {
    setError("");
    setLoading(true);
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
      const provider = new ethers.BrowserProvider(window.ethereum);
      const block = await provider.getBlock("latest");
      const currentTimestamp = block.timestamp;
      
      const cliffTime = cliffSeconds > 0 ? currentTimestamp + Number(cliffSeconds) : 0;
      const stopTime = stopSeconds > 0 ? currentTimestamp + Number(stopSeconds) : 0;

      const tx = await registryContract.createSubscription(
        merchantAddress,
        tokenAddress,
        ratePerSecond,
        cliffTime,
        stopTime
      );
      await tx.wait();
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Claim stream funds
  const claimStream = async (subId) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.claimStream(subId);
      await tx.wait();
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Open Dispute (Option A)
  const openDispute = async (subId) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.openDispute(subId);
      await tx.wait();
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Resolve Dispute (Option A)
  const resolveDisputeOnChain = async (subId, subscriberRefund, merchantShare, signature) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.resolveDispute(subId, subscriberRefund, merchantShare, signature);
      await tx.wait();
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Transfer NFT Subscription (Option B)
  const transferStreamNFT = async (subId, toAddress) => {
    setError("");
    setLoading(true);
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

      const tx = await registryContract.transferFrom(account, recipient, tokenId);
      await tx.wait();
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Resume paused stream
  const resumeStream = async (subId) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.resumeStream(subId);
      await tx.wait();
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Terminate active stream
  const terminateStream = async (subId) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.terminateStream(subId);
      await tx.wait();
      await fetchSubscriptions();
      setLoading(false);
    } catch (err) {
      setError(err.message);
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
