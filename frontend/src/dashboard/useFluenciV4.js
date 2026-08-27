import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  REGISTRY_V4_ABI, ATTESTOR_ABI, ERC20_ABI, V4_REGISTRY, V4_ATTESTOR, V4_TOKEN,
  V4_CONFIGURED, REPUTATION_API, QUSDC_DECIMALS, QIE_PASS_ABI,
} from "./v4Config";

const RPC = import.meta.env.VITE_V4_RPC_URL || "https://rpc1mainnet.qie.digital";

/**
 * v4-specific chain access, layered beside useFluenci rather than inside it.
 * Keeping them separate means the live v1 dashboard is untouched while v2 is
 * reviewed, and v4 can be pointed at a local node without disturbing anything.
 */
export function useFluenciV4({ account, tokenAddress: tokenOverride }) {
  const tokenAddress = tokenOverride || V4_TOKEN;
  const [subscriptions, setSubscriptions] = useState([]);
  const [merchantStreams, setMerchantStreams] = useState([]);
  const [limits, setLimits] = useState([]);
  const [policy, setPolicy] = useState({ gate: 0, minReputation: 700n });
  const [protocolFeeBps, setProtocolFeeBps] = useState(50);
  const [reputationGateAvailable, setReputationGateAvailable] = useState(false);
  const [merchantVerified, setMerchantVerified] = useState(false);
  const [kycRequired, setKycRequired] = useState(true);
  const [claimableNet, setClaimableNet] = useState(0n);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [txState, setTxState] = useState({ status: "idle", action: "", hash: "", error: "" });
  const resetTx = useCallback(() => setTxState({ status: "idle", action: "", hash: "", error: "" }), []);
  const providerRef = useRef(null);

  const readProvider = useCallback(() => {
    if (!providerRef.current) providerRef.current = new ethers.JsonRpcProvider(RPC);
    return providerRef.current;
  }, []);

  const readRegistry = useCallback(
    () => (V4_CONFIGURED ? new ethers.Contract(V4_REGISTRY, REGISTRY_V4_ABI, readProvider()) : null),
    [readProvider]
  );

  const writeRegistry = useCallback(async () => {
    const injected = window.ethereum;
    if (!injected) throw new Error("No wallet found");
    const signer = await new ethers.BrowserProvider(injected).getSigner();
    return new ethers.Contract(V4_REGISTRY, REGISTRY_V4_ABI, signer);
  }, []);

  // --- reads ---------------------------------------------------------------
  const refresh = useCallback(async () => {
    const reg = readRegistry();
    if (!reg || !account) return;
    setLoading(true);
    setError(null);
    try {
      const [mineIds, merchantIds, feeBps, repAddr] = await Promise.all([
        reg.getSubscriberSubscriptions(account),
        reg.getMerchantSubscriptions(account),
        reg.protocolFeeBps().catch(() => 50n),
        reg.qieReputation().catch(() => ethers.ZeroAddress),
      ]);
      setProtocolFeeBps(Number(feeBps));
      setReputationGateAvailable(repAddr && repAddr !== ethers.ZeroAddress);

      const hydrate = async (id) => {
        const [s, owed] = await Promise.all([reg.getSubscription(id), reg.previewOwed(id).catch(() => 0n)]);
        return {
          id,
          merchant: s.merchant,
          subscriber: s.subscriber,
          merchantName: null, // resolved separately via .qie lookup
          amountPerPeriod: s.amountPerPeriod,
          periodSeconds: Number(s.periodSeconds),
          active: s.active,
          pausedByAI: s.pausedByAI,
          dispute: Number(s.dispute),
          settledAmount: s.settledAmount,
          owed,
        };
      };

      const mine = await Promise.all(mineIds.map(hydrate));
      const theirs = await Promise.all(merchantIds.map(hydrate));
      setSubscriptions(mine.filter((s) => s.active));
      setMerchantStreams(theirs.filter((s) => s.active));

      // One cap row per distinct merchant - caps are per (subscriber, merchant).
      const merchants = [...new Set(mine.filter((s) => s.active).map((s) => s.merchant))];
      const caps = await Promise.all(
        merchants.map(async (m) => {
          const c = await reg.spendCaps(account, m);
          return {
            merchant: m,
            merchantName: null,
            maxAmount: c.set ? c.maxAmount : null,
            periodSeconds: c.set ? Number(c.periodSeconds) : null,
            used: c.set ? c.spentInWindow : 0n,
            windowStart: c.set ? Number(c.windowStart) : null,
            set: c.set,
          };
        })
      );
      setLimits(caps);

      const [gate, minRep] = await reg.getMerchantGate(account);
      setPolicy({ gate: Number(gate), minReputation: minRep });

      // Ask the registry which QIE Pass IT enforces. Reading a chain-mapped
      // address instead meant the Claim button stayed disabled while the
      // registry considered the merchant perfectly verified.
      try {
        const passAddr = await reg.qiePass();
        if (passAddr && passAddr !== ethers.ZeroAddress) {
          const pass = new ethers.Contract(passAddr, QIE_PASS_ABI, readProvider());
          setMerchantVerified(await pass.verifyIdentity(account));
        }
      } catch { setMerchantVerified(false); }
      try { setKycRequired(await reg.requireMerchantKyc()); } catch { setKycRequired(true); }

      // What can actually be withdrawn today: previewOwed is documented as being
      // BEFORE the spend cap, so showing it raw promised money the claim reverts on.
      let net = 0n;
      for (const s of theirs.filter((x) => x.active)) {
        const room = await reg.remainingAllowance(s.subscriber ?? account, account).catch(() => null);
        const owed = s.owed ?? 0n;
        net += room === null ? owed : (owed < room ? owed : room);
      }
      setClaimableNet(net);
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [account, readRegistry]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Off-chain reputation. Endpoint is injected, never hardcoded - returns null when unconfigured. */
  const fetchReputation = useCallback(async (address) => {
    if (!REPUTATION_API || !address) return null;
    try {
      const res = await fetch(`${REPUTATION_API.replace(/\/$/, "")}/reputation/public/${address}`);
      if (!res.ok) return null;
      const body = await res.json();
      const d = body?.data ?? body;
      return { score: d?.score ?? null, tier: d?.tier ?? null, modelVersion: d?.modelVersion ?? null };
    } catch {
      return null;
    }
  }, []);

  // --- writes --------------------------------------------------------------
  // QIE's RPC mis-reports gas, so ethers' estimation/fee pipeline stalls after
  // the wallet signs. v1 works around this by sending eth_sendTransaction
  // directly with an explicit gas limit and letting the wallet set gas price;
  // v4 writes now do the same.
  const registryIface = useMemo(() => new ethers.Interface(REGISTRY_V4_ABI), []);
  const erc20Iface = useMemo(() => new ethers.Interface(ERC20_ABI), []);

  const sendDirect = useCallback(async (to, iface, method, args, gasLimit) => {
    const injected = window.ethereum;
    if (!injected) throw new Error("No wallet found");
    const data = iface.encodeFunctionData(method, args);
    const hash = await injected.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to, data, gas: "0x" + BigInt(gasLimit).toString(16) }],
    });
    if (!hash) throw new Error("Wallet did not return a transaction hash");
    return hash;
  }, [account]);

  const run = useCallback(async (key, action, fn) => {
    setBusy(key);
    setError(null);
    setTxState({ status: "awaiting_signature", action, hash: "", error: "" });
    try {
      const hash = await fn();
      setTxState({ status: "confirming", action, hash, error: "" });
      await readProvider().waitForTransaction(hash);
      setTxState({ status: "confirmed", action, hash, error: "" });
      await refresh();
      return true;
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      setError(msg);
      setTxState({ status: "error", action, hash: "", error: msg });
      return false;
    } finally {
      setBusy(null);
    }
  }, [readProvider, refresh]);

  /** Approve the registry to pull `needed` of the token, if the allowance is short. */
  const ensureAllowance = useCallback(async (needed) => {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider());
    const current = await token.allowance(account, V4_REGISTRY);
    if (current >= needed) return;
    const hash = await sendDirect(tokenAddress, erc20Iface, "approve", [V4_REGISTRY, needed], 80000n);
    await readProvider().waitForTransaction(hash);
  }, [account, tokenAddress, erc20Iface, sendDirect, readProvider]);

  const createSubscription = useCallback(
    ({ merchant, amountPerPeriod, periodSeconds, cliffTime = 0, stopTime = 0, token }) =>
      run("create", "Approve and start subscription", async () => {
        const amt = BigInt(amountPerPeriod);
        const per = BigInt(periodSeconds);
        const headroom = (amt * 31_536_000n) / (per > 0n ? per : 1n);
        await ensureAllowance(headroom > 0n ? headroom : amt);
        return sendDirect(V4_REGISTRY, registryIface, "createSubscription",
          [merchant, token || tokenAddress, amt, per, BigInt(cliffTime || 0), BigInt(stopTime || 0)], 400000n);
      }),
    [run, tokenAddress, ensureAllowance, sendDirect, registryIface]
  );

  const setSpendCap = useCallback(
    (merchant, maxAmount, periodSeconds) =>
      run(`cap:${merchant}`, "Set spending limit", () =>
        sendDirect(V4_REGISTRY, registryIface, "setSpendCap", [merchant, BigInt(maxAmount), BigInt(periodSeconds)], 150000n)),
    [run, sendDirect, registryIface]
  );
  const clearSpendCap = useCallback((merchant) =>
    run(`cap:${merchant}`, "Remove spending limit", () =>
      sendDirect(V4_REGISTRY, registryIface, "clearSpendCap", [merchant], 100000n)), [run, sendDirect, registryIface]);
  const setMerchantPolicy = useCallback((gate, minRep) =>
    run("policy", "Save access policy", () =>
      sendDirect(V4_REGISTRY, registryIface, "setMerchantPolicy", [gate, BigInt(minRep || 0)], 120000n)), [run, sendDirect, registryIface]);
  const claimStream = useCallback((subId) =>
    run("claim", "Claim earnings", () =>
      sendDirect(V4_REGISTRY, registryIface, "claimStream", [subId], 300000n)), [run, sendDirect, registryIface]);
  const terminateStream = useCallback((subId) =>
    run("terminate", "Cancel subscription", () =>
      sendDirect(V4_REGISTRY, registryIface, "terminateStream", [subId], 300000n)), [run, sendDirect, registryIface]);
  const openDispute = useCallback((subId) =>
    run("dispute", "Open dispute", () =>
      sendDirect(V4_REGISTRY, registryIface, "openDispute", [subId], 200000n)), [run, sendDirect, registryIface]);

  // Gross accrued, and what is actually withdrawable once caps are applied.
  const claimableGross = useMemo(
    () => merchantStreams.reduce((acc, s) => acc + (s.owed ?? 0n), 0n),
    [merchantStreams]
  );
  const claimable = claimableNet;

  return {
    configured: V4_CONFIGURED,
    attestorConfigured: Boolean(V4_ATTESTOR),
    reputationApiConfigured: Boolean(REPUTATION_API),
    decimals: QUSDC_DECIMALS,
    loading, busy, error, txState, resetTx,
    subscriptions, merchantStreams, limits, policy, protocolFeeBps,
    reputationGateAvailable, claimable, claimableGross, merchantVerified, kycRequired,
    tokenAddress, ensureAllowance,
    refresh, fetchReputation,
    createSubscription, setSpendCap, clearSpendCap, setMerchantPolicy,
    claimStream, terminateStream, openDispute,
  };
}
