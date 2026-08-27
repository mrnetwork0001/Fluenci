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
  const run = useCallback(async (key, fn, action = "Onchain transaction") => {
    setBusy(key);
    setError(null);
    setTxState({ status: "preparing", action, hash: "", error: "" });
    try {
      const c = await writeRegistry();
      // The wallet prompt(s) happen inside fn — approve then the write itself.
      setTxState({ status: "awaiting_signature", action, hash: "", error: "" });
      const tx = await fn(c);
      setTxState({ status: "broadcasting", action, hash: tx?.hash || "", error: "" });
      setTxState((s) => ({ ...s, status: "confirming" }));
      await tx.wait();
      setTxState({ status: "confirmed", action, hash: tx?.hash || "", error: "" });
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
  }, [writeRegistry, refresh]);

  /** Ensure the V4 registry can pull `needed` of the streaming token. */
  const ensureAllowance = useCallback(async (signer, needed) => {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    const current = await token.allowance(owner, V4_REGISTRY);
    if (current >= needed) return true;
    const tx = await token.approve(V4_REGISTRY, needed);
    await tx.wait();
    return true;
  }, [tokenAddress]);

  const createSubscription = useCallback(
    ({ merchant, amountPerPeriod, periodSeconds, cliffTime = 0, stopTime = 0, token }) =>
      run("create", async (c) => {
        // The button says "Approve and start streaming"; it has to actually approve.
        // A year of the agreed price is a sane default headroom.
        const runner = c.runner;
        const headroom = (amountPerPeriod * 31_536_000n) / BigInt(periodSeconds || 1);
        await ensureAllowance(runner, headroom > 0n ? headroom : amountPerPeriod);
        return c.createSubscription(merchant, token || tokenAddress, amountPerPeriod, periodSeconds, cliffTime, stopTime);
      }, "Approve and start subscription"),
    [run, tokenAddress, ensureAllowance]
  );

  const setSpendCap = useCallback(
    (merchant, maxAmount, periodSeconds) => run(`cap:${merchant}`, (c) => c.setSpendCap(merchant, maxAmount, periodSeconds), "Set spending limit"),
    [run]
  );
  const clearSpendCap = useCallback((merchant) => run(`cap:${merchant}`, (c) => c.clearSpendCap(merchant), "Remove spending limit"), [run]);
  const setMerchantPolicy = useCallback((gate, minRep) => run("policy", (c) => c.setMerchantPolicy(gate, minRep), "Save access policy"), [run]);
  const claimStream = useCallback((subId) => run("claim", (c) => c.claimStream(subId), "Claim earnings"), [run]);
  const terminateStream = useCallback((subId) => run("terminate", (c) => c.terminateStream(subId), "Cancel subscription"), [run]);
  const openDispute = useCallback((subId) => run("dispute", (c) => c.openDispute(subId), "Open dispute"), [run]);

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
    reputationGateAvailable, claimable, claimableGross, merchantVerified,
    tokenAddress, ensureAllowance,
    refresh, fetchReputation,
    createSubscription, setSpendCap, clearSpendCap, setMerchantPolicy,
    claimStream, terminateStream, openDispute,
  };
}
