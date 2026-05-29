import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

// ABI definitions
const REGISTRY_ABI = [
  "function createSubscription(address merchant, uint256 ratePerSecond) external returns (bytes32)",
  "function claimStream(bytes32 subId) external",
  "function resumeStream(bytes32 subId) external",
  "function terminateStream(bytes32 subId) external",
  "function getSubscriberSubscriptions(address subscriber) external view returns (bytes32[] memory)",
  "function getMerchantSubscriptions(address merchant) external view returns (bytes32[] memory)",
  "function getSubscriptionDetails(bytes32 subId) external view returns (address subscriber, address merchant, uint256 ratePerSecond, uint256 lastClaimedTimestamp, uint256 startTime, bool active, bool pausedByAI, uint256 claimableAmount)",
  "function qiePass() external view returns (address)",
  "function qieStableCoin() external view returns (address)"
];

const STABLECOIN_ABI = [
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

export function useQieFlow() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [qusdBalance, setQusdBalance] = useState("0");
  const [qiePassVerified, setQiePassVerified] = useState(false);
  const [qusdAllowance, setQusdAllowance] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subscriberStreams, setSubscriberStreams] = useState([]);
  const [merchantStreams, setMerchantStreams] = useState([]);
  const [realtimeClaimables, setRealtimeClaimables] = useState({});

  // Dynamic contract addresses configuration
  const [contracts, setContracts] = useState({
    registry: localStorage.getItem("qieflow_registry") || "",
    qusd: localStorage.getItem("qieflow_qusd") || "",
    qiepass: localStorage.getItem("qieflow_qiepass") || "",
    auditor: localStorage.getItem("qieflow_auditor") || ""
  });

  const updateContractAddresses = (newConfig) => {
    setContracts(newConfig);
    Object.entries(newConfig).forEach(([key, val]) => {
      localStorage.setItem(`qieflow_${key}`, val);
    });
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
      // 4902: chain has not been added
      if (err.code === 4902) {
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
        }
      }
    }
  };

  const connectWallet = async () => {
    setError("");
    setLoading(true);
    try {
      if (!window.ethereum) {
        throw new Error("Please install MetaMask to interact with QieFlow");
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      setAccount(address);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      // Trigger automatic network check
      if (Number(network.chainId) !== 1983 && Number(network.chainId) !== 31337) {
        // Not QIE Testnet and not localhost
        await switchToQieTestnet();
      }

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Fetch account balances & QIE Pass verification status
  const fetchAccountState = useCallback(async () => {
    if (!account || !contracts.qusd || !contracts.qiepass) return;

    try {
      const { provider } = await getProviderAndSigner();
      
      // Fetch qUSD Balance
      const qusdContract = new ethers.Contract(contracts.qusd, STABLECOIN_ABI, provider);
      const balanceVal = await qusdContract.balanceOf(account);
      setQusdBalance(ethers.formatUnits(balanceVal, 6));

      // Fetch Allowance
      if (contracts.registry) {
        const allowanceVal = await qusdContract.allowance(account, contracts.registry);
        setQusdAllowance(ethers.formatUnits(allowanceVal, 6));
      }

      // Fetch QIE Pass status
      const passContract = new ethers.Contract(contracts.qiepass, QIEPASS_ABI, provider);
      const isVerified = await passContract.verifyIdentity(account);
      setQiePassVerified(isVerified);
    } catch (err) {
      console.error("Failed to fetch account state", err);
    }
  }, [account, contracts]);

  // Fetch subscriptions
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
          return {
            id,
            subscriber: details[0],
            merchant: details[1],
            ratePerSecond: Number(details[2]),
            lastClaimedTimestamp: Number(details[3]),
            startTime: Number(details[4]),
            active: details[5],
            pausedByAI: details[6],
            claimableAmount: Number(details[7]) / 1e6
          };
        })
      );
      setSubscriberStreams(subDetailsList);

      // Fetch merchant streams
      const merIds = await registryContract.getMerchantSubscriptions(account);
      const merDetailsList = await Promise.all(
        merIds.map(async (id) => {
          const details = await registryContract.getSubscriptionDetails(id);
          return {
            id,
            subscriber: details[0],
            merchant: details[1],
            ratePerSecond: Number(details[2]),
            lastClaimedTimestamp: Number(details[3]),
            startTime: Number(details[4]),
            active: details[5],
            pausedByAI: details[6],
            claimableAmount: Number(details[7]) / 1e6
          };
        })
      );
      setMerchantStreams(merDetailsList);
    } catch (err) {
      console.error("Failed to fetch subscriptions", err);
    }
  }, [account, contracts]);

  // Mint mock stablecoins
  const mintMockQUSD = async (amount) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const qusdContract = new ethers.Contract(contracts.qusd, STABLECOIN_ABI, signer);
      const tx = await qusdContract.mint(account, ethers.parseUnits(amount, 6));
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Approve Stablecoin
  const approveQUSD = async () => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const qusdContract = new ethers.Contract(contracts.qusd, STABLECOIN_ABI, signer);
      const tx = await qusdContract.approve(contracts.registry, ethers.MaxUint256);
      await tx.wait();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Toggle QIE Pass Verified Status (Only for mock contract testing)
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

  // Create subscription
  const createSubscription = async (merchant, ratePerSecond) => {
    setError("");
    setLoading(true);
    try {
      const { signer } = await getProviderAndSigner();
      const registryContract = new ethers.Contract(contracts.registry, REGISTRY_ABI, signer);
      const tx = await registryContract.createSubscription(merchant, ratePerSecond);
      await tx.wait();
      await fetchSubscriptions();
      await fetchAccountState();
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Claim stream accumulated funds
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

  // Setup Accounts Event Listeners
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

      // Poll every 5 seconds for block state changes
      const interval = setInterval(() => {
        fetchAccountState();
        fetchSubscriptions();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [account, fetchAccountState, fetchSubscriptions]);

  // Real-time animation counter ticker for streaming funds
  const requestRef = useRef();
  const lastUpdateRef = useRef(Date.now());

  const animate = useCallback(() => {
    const now = Date.now();
    
    // Update real-time counters based on time elapsed
    setRealtimeClaimables((prev) => {
      const next = { ...prev };
      let updated = false;

      // Merge both list streams to calculate
      const allStreams = [...subscriberStreams, ...merchantStreams];
      
      allStreams.forEach((stream) => {
        if (stream.active && !stream.pausedByAI) {
          const currentUnix = Math.floor(now / 1000);
          const elapsed = currentUnix - stream.lastClaimedTimestamp;
          
          if (elapsed > 0) {
            // Precise claimable calculation (ratePerSecond is scaled by 1e6, so divide by 1e6)
            const claimable = (elapsed * stream.ratePerSecond) / 1e6;
            // Add sub-second fraction for visual smoothness
            const subsecondFraction = ((now % 1000) / 1000) * (stream.ratePerSecond / 1e6);
            const smoothClaimable = claimable + subsecondFraction;
            
            if (next[stream.id] !== smoothClaimable) {
              next[stream.id] = smoothClaimable;
              updated = true;
            }
          } else {
            next[stream.id] = 0;
            updated = true;
          }
        } else if (stream.pausedByAI) {
          // If paused, claimable stops accumulating
          next[stream.id] = (Math.max(0, stream.lastClaimedTimestamp - stream.startTime) * stream.ratePerSecond) / 1e6;
          updated = true;
        } else {
          next[stream.id] = 0;
          updated = true;
        }
      });

      return updated ? next : prev;
    });

    lastUpdateRef.current = now;
    requestRef.current = requestAnimationFrame(animate);
  }, [subscriberStreams, merchantStreams]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [animate]);

  return {
    account,
    chainId,
    qusdBalance,
    qusdAllowance,
    qiePassVerified,
    subscriberStreams,
    merchantStreams,
    realtimeClaimables,
    loading,
    error,
    contracts,
    connectWallet,
    mintMockQUSD,
    approveQUSD,
    toggleQiePassStatus,
    createSubscription,
    claimStream,
    resumeStream,
    terminateStream,
    updateContractAddresses,
    refreshData: () => {
      fetchAccountState();
      fetchSubscriptions();
    }
  };
}
