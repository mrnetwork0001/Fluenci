import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  REGISTRY_V4_ABI, ATTESTOR_ABI, ERC20_ABI, V4_REGISTRY, V4_ATTESTOR, V4_TOKEN,
  V4_CONFIGURED, REPUTATION_API, REPUTATION_LIVE, QUSDC_DECIMALS, QIE_PASS_ABI,
  EXPECTED_CHAIN_ID, STABLECOINS,
} from "./v4Config";

const RPC = import.meta.env.VITE_V4_RPC_URL || "https://rpc1mainnet.qie.digital";

/** One registry subscription, shaped for the UI. Shared by the bulk refresh and single re-reads. */
function toSub(id, s, owed) {
  return {
    id,
    merchant: s.merchant,
    subscriber: s.subscriber,
    merchantName: null, // resolved separately via .qie lookup
    tokenAddress: s.tokenAddress,
    cliffTime: Number(s.cliffTime),
    amountPerPeriod: s.amountPerPeriod,
    periodSeconds: Number(s.periodSeconds),
    active: s.active,
    pausedByAI: s.pausedByAI,
    dispute: Number(s.dispute),
    stopTime: Number(s.stopTime),
    settledAmount: s.settledAmount,
    owed,
  };
}

/** A mined-but-reverted transaction must not be reported as done. */
function assertMined(receipt) {
  if (receipt && Number(receipt.status) === 0) throw new Error("The transaction was reverted on-chain.");
  return receipt;
}

// Stable empties, so screens memoising on these never see a new identity per render.
const NO_ROWS = [];
const DEFAULT_POLICY = { gate: 0, minReputation: 50n };

/**
 * v4-specific chain access, layered beside useFluenci rather than inside it.
 * Keeping them separate means the live v1 dashboard is untouched while v2 is
 * reviewed, and v4 can be pointed at a local node without disturbing anything.
 */
export function useFluenciV4({ account, tokenAddress: tokenOverride, getProvider = null }) {
  const tokenAddress = tokenOverride || V4_TOKEN;
  // Held in a ref so a new function identity from the caller never re-creates
  // every write callback below.
  const getProviderRef = useRef(getProvider);
  useEffect(() => { getProviderRef.current = getProvider; }, [getProvider]);
  // Everything read for one wallet, committed together and tagged with that
  // wallet. A snapshot for another account is never exposed, so a wallet switch
  // can't show (or gate on) the previous wallet's subscriptions. Its presence
  // for the current account is also what "loaded" means: screens that gate on
  // subscriptions (the Arcade pass) never offer "buy" before it exists.
  const [snapshot, setSnapshot] = useState(null);
  const [protocolFeeBps, setProtocolFeeBps] = useState(50);
  const [reputationGateAvailable, setReputationGateAvailable] = useState(false);
  const [idGateAvailable, setIdGateAvailable] = useState(false);
  const [kycRequired, setKycRequired] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [txState, setTxState] = useState({ status: "idle", action: "", hash: "", error: "" });
  const resetTx = useCallback(() => setTxState({ status: "idle", action: "", hash: "", error: "" }), []);
  // The account whose latest refresh failed, so a screen can offer a retry
  // instead of acting on missing data.
  const [loadFailedFor, setLoadFailedFor] = useState(null);
  // A wallet switch drops everything read so far, even when switching back to
  // a wallet read earlier: its subscriptions may have changed since.
  const [dataAccount, setDataAccount] = useState(account);
  if (dataAccount !== account) {
    setDataAccount(account);
    setSnapshot(null);
    setLoadFailedFor(null);
  }
  // Only the newest refresh for the current account may commit.
  const refreshSeq = useRef(0);
  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);
  const providerRef = useRef(null);

  const current = snapshot && account && snapshot.account === account ? snapshot : null;
  const subscriptions = current?.subscriptions ?? NO_ROWS;
  const merchantStreams = current?.merchantStreams ?? NO_ROWS;
  const limits = current?.limits ?? NO_ROWS;
  const policy = current?.policy ?? DEFAULT_POLICY;
  const merchantVerified = current?.merchantVerified ?? false;
  const claimableNet = current?.claimableNet ?? 0n;

  const readProvider = useCallback(() => {
    if (!providerRef.current) providerRef.current = new ethers.JsonRpcProvider(RPC);
    return providerRef.current;
  }, []);

  const readRegistry = useCallback(
    () => (V4_CONFIGURED ? new ethers.Contract(V4_REGISTRY, REGISTRY_V4_ABI, readProvider()) : null),
    [readProvider]
  );

  // --- reads ---------------------------------------------------------------
  const refresh = useCallback(async () => {
    const reg = readRegistry();
    if (!reg || !account) return;
    // A refresh started from a previous wallet's closure (say, a tx that
    // confirmed after the switch) must not start, let alone commit.
    if (account !== accountRef.current) return;
    const seq = ++refreshSeq.current;
    const isLatest = () => seq === refreshSeq.current && account === accountRef.current;
    setLoading(true);
    setError(null);
    try {
      const [mineIds, merchantIds, feeBps, repAddr, idAddr] = await Promise.all([
        reg.getSubscriberSubscriptions(account),
        reg.getMerchantSubscriptions(account),
        reg.protocolFeeBps().catch(() => 50n),
        reg.qieReputation().catch(() => ethers.ZeroAddress),
        reg.qieIdentity().catch(() => ethers.ZeroAddress),
      ]);

      const hydrate = async (id) => {
        const [s, owed] = await Promise.all([reg.getSubscription(id), reg.previewOwed(id).catch(() => 0n)]);
        return toSub(id, s, owed);
      };

      const mine = (await Promise.all(mineIds.map(hydrate))).filter((s) => s.active);
      const theirs = (await Promise.all(merchantIds.map(hydrate))).filter((s) => s.active);

      // One cap row per distinct merchant - caps are per (subscriber, merchant).
      const merchants = [...new Set(mine.map((s) => s.merchant))];
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

      const [gate, minRep] = await reg.getMerchantGate(account);

      // Ask the registry which QIE Pass IT enforces. Reading a chain-mapped
      // address instead meant the Claim button stayed disabled while the
      // registry considered the merchant perfectly verified.
      let verified = false;
      try {
        const passAddr = await reg.qiePass();
        if (passAddr && passAddr !== ethers.ZeroAddress) {
          const pass = new ethers.Contract(passAddr, QIE_PASS_ABI, readProvider());
          verified = Boolean(await pass.verifyIdentity(account));
        }
      } catch { verified = false; }
      let kyc = true;
      try { kyc = await reg.requireMerchantKyc(); } catch { kyc = true; }

      // What can actually be withdrawn today: previewOwed is documented as being
      // BEFORE the spend cap, so showing it raw promised money the claim reverts on.
      let net = 0n;
      for (const s of theirs) {
        const room = await reg.remainingAllowance(s.subscriber ?? account, account).catch(() => null);
        const owed = s.owed ?? 0n;
        net += room === null ? owed : (owed < room ? owed : room);
      }

      if (!isLatest()) return;
      setProtocolFeeBps(Number(feeBps));
      // Adapter wired AND scores actually flowing (QIE's signer live).
      setReputationGateAvailable(Boolean(repAddr && repAddr !== ethers.ZeroAddress && REPUTATION_LIVE));
      setIdGateAvailable(Boolean(idAddr && idAddr !== ethers.ZeroAddress));
      setKycRequired(kyc);
      setSnapshot({
        account,
        subscriptions: mine,
        merchantStreams: theirs,
        limits: caps,
        policy: { gate: Number(gate), minReputation: minRep },
        merchantVerified: verified,
        claimableNet: net,
      });
      setLoadFailedFor(null);
    } catch (e) {
      if (!isLatest()) return;
      // Keep the last good snapshot (if any) and flag the failure: an empty
      // list here used to read as "no subscriptions" and offered a second pass.
      setError(e?.shortMessage || e?.message || String(e));
      setLoadFailedFor(account);
    } finally {
      // Sequence only: after a disconnect no newer refresh exists to clear it.
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, [account, readRegistry, readProvider]);

  /** Fresh read of one subscription (owed, stopTime, pause and dispute change without events we listen to). Throws on any read error. */
  const readSubscription = useCallback(async (id) => {
    const reg = readRegistry();
    if (!reg || !id) return null;
    const [s, owed] = await Promise.all([reg.getSubscription(id), reg.previewOwed(id)]);
    return toSub(id, s, owed);
  }, [readRegistry]);

  /**
   * Every subscription `owner` has opened, read straight from the registry
   * (not the last refresh). `owed` is not read here and is left null. Throws on
   * any read error, so a caller deciding "is there already one?" fails closed.
   */
  const readSubscriberSubscriptions = useCallback(async (owner = account) => {
    const reg = readRegistry();
    if (!reg || !owner) throw new Error("The registry isn't available.");
    const ids = await reg.getSubscriberSubscriptions(owner);
    return Promise.all(ids.map(async (id) => toSub(id, await reg.getSubscription(id), null)));
  }, [readRegistry, account]);

  /** The subscriber's spending cap on `merchant` ({ set, maxAmount, periodSeconds }). */
  const readSpendCap = useCallback(async (merchant, owner = account) => {
    const reg = readRegistry();
    if (!reg || !merchant || !owner) return { set: false, maxAmount: 0n, periodSeconds: 0 };
    const c = await reg.spendCaps(owner, merchant);
    return { set: c.set, maxAmount: c.maxAmount, periodSeconds: Number(c.periodSeconds) };
  }, [readRegistry, account]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Off-chain reputation, display only. Endpoint is injected, never hardcoded - returns null when unconfigured. */
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

  /**
   * Ask the backend for a signed reputation attestation for `address`. The
   * backend holds the DRS api-key and the authorised signer; it returns the
   * attestation tuple + signature that submitAttestation() takes.
   */
  const fetchReputationAttestation = useCallback(async (address) => {
    if (!REPUTATION_API || !address) return null;
    try {
      const res = await fetch(`${REPUTATION_API.replace(/\/$/, "")}/reputation/attest/${address}`);
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.attestation || !body?.signature) return null;
      return body; // { ok, address, score, tier, attestation, signature }
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
  const attestorIface = useMemo(() => new ethers.Interface(ATTESTOR_ABI), []);

  /** The wallet the user connected - never assume window.ethereum (QIE Mobile / WalletConnect). */
  const getWallet = useCallback(() => {
    const fromCaller = typeof getProviderRef.current === "function" ? getProviderRef.current() : null;
    return fromCaller || (typeof window !== "undefined" ? window.ethereum : null) || null;
  }, []);

  /**
   * Refuse to sign on the wrong chain. eth_sendTransaction carries no chainId,
   * so a MetaMask user sitting on Ethereum would otherwise sign a QIE call
   * against Ethereum. Switch first; add QIE only if the wallet has never seen it.
   */
  const ensureChain = useCallback(async (wallet) => {
    const want = "0x" + EXPECTED_CHAIN_ID.toString(16);
    const current = async () => Number(await wallet.request({ method: "eth_chainId" }));
    if ((await current()) === EXPECTED_CHAIN_ID) return;
    try {
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e) {
      const unknownChain = e?.code === 4902 || e?.data?.originalError?.code === 4902 ||
        /unrecognized|not been added|unknown chain/i.test(e?.message || "");
      if (!unknownChain || EXPECTED_CHAIN_ID !== 1990) {
        throw new Error("Switch your wallet to QIE Mainnet to continue.", { cause: e });
      }
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: want,
          chainName: "QIE Mainnet",
          nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
          rpcUrls: ["https://rpc1mainnet.qie.digital"],
          blockExplorerUrls: ["https://mainnet.qie.digital/"],
        }],
      });
    }
    if ((await current()) !== EXPECTED_CHAIN_ID) {
      throw new Error("Switch your wallet to QIE Mainnet to continue.");
    }
  }, []);

  const sendDirect = useCallback(async (to, iface, method, args, gasLimit) => {
    const wallet = getWallet();
    if (!wallet) throw new Error("No wallet found");
    await ensureChain(wallet);
    const data = iface.encodeFunctionData(method, args);
    const hash = await wallet.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to, data, gas: "0x" + BigInt(gasLimit).toString(16) }],
    });
    if (!hash) throw new Error("Wallet did not return a transaction hash");
    return hash;
  }, [account, getWallet, ensureChain]);

  const run = useCallback(async (key, action, fn) => {
    setBusy(key);
    setError(null);
    setTxState({ status: "awaiting_signature", action, hash: "", error: "" });
    try {
      const hash = await fn();
      setTxState({ status: "confirming", action, hash, error: "" });
      // A reverted transaction is still mined; without this check a failed
      // spend-cap write read as success and the flow went on to subscribe uncapped.
      assertMined(await readProvider().waitForTransaction(hash));
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

  // Reputation attestation writes. Declared AFTER run/sendDirect/attestorIface:
  // a useCallback dep array is read during render, so referencing a const that
  // is declared later would hit the temporal dead zone and crash the dashboard.
  /** Record a signed attestation on-chain so the reputation gate can read the score. */
  const submitAttestation = useCallback((attestation, signature) => {
    const a = [
      attestation.wallet,
      BigInt(attestation.score),
      attestation.tier,
      attestation.modelVersion,
      BigInt(attestation.issuedAt),
      BigInt(attestation.expiresAt),
      BigInt(attestation.chainId),
    ];
    return run("submitAttestation", "Recording reputation",
      () => sendDirect(V4_ATTESTOR, attestorIface, "submitAttestation", [a, signature], 250000n));
  }, [run, sendDirect, attestorIface]);

  /** Fetch a fresh attestation for the connected wallet and record it on-chain. */
  const verifyReputation = useCallback(async () => {
    if (!account) return null;
    const att = await fetchReputationAttestation(account);
    if (!att) throw new Error("Could not retrieve a reputation attestation. Check that the reputation service is reachable.");
    await submitAttestation(att.attestation, att.signature);
    return att;
  }, [account, fetchReputationAttestation, submitAttestation]);

  /**
   * Approve the registry to pull `needed` of `token`, if the allowance is short.
   * Takes the token explicitly: approving the default qUSDC while subscribing in
   * a bridged stablecoin would leave the real token unapproved and every claim reverting.
   */
  const ensureAllowance = useCallback(async (needed, token = tokenAddress) => {
    const erc20 = new ethers.Contract(token, ERC20_ABI, readProvider());
    const current = await erc20.allowance(account, V4_REGISTRY);
    if (current >= needed) return;
    const hash = await sendDirect(token, erc20Iface, "approve", [V4_REGISTRY, needed], 80000n);
    assertMined(await readProvider().waitForTransaction(hash));
  }, [account, tokenAddress, erc20Iface, sendDirect, readProvider]);

  /** Re-grant the registry's allowance on `token` (fixes a pass that lapsed for lack of approval). */
  const reapprove = useCallback((token, amount) =>
    run("approve", "Approve subscription payments", () =>
      sendDirect(token, erc20Iface, "approve", [V4_REGISTRY, BigInt(amount)], 80000n)),
  [run, sendDirect, erc20Iface]);

  /** Put the connected wallet on the v4 chain, for flows that send outside sendDirect (e.g. swaps). */
  const ensureWalletChain = useCallback(async () => {
    const wallet = getWallet();
    if (!wallet) throw new Error("No wallet found");
    await ensureChain(wallet);
  }, [getWallet, ensureChain]);

  const createSubscription = useCallback(
    ({ merchant, amountPerPeriod, periodSeconds, cliffTime = 0, stopTime = 0, token }) =>
      run("create", "Approve and start subscription", async () => {
        const payToken = token || tokenAddress;
        const amt = BigInt(amountPerPeriod);
        const per = BigInt(periodSeconds);
        const headroom = (amt * 31_536_000n) / (per > 0n ? per : 1n);
        await ensureAllowance(headroom > 0n ? headroom : amt, payToken);
        return sendDirect(V4_REGISTRY, registryIface, "createSubscription",
          [merchant, payToken, amt, per, BigInt(cliffTime || 0), BigInt(stopTime || 0)], 400000n);
      }),
    [run, tokenAddress, ensureAllowance, sendDirect, registryIface]
  );

  /**
   * Balance and registry allowance of one ERC-20 for `owner` (defaults to the
   * connected account). Throws on a read error rather than reporting 0, so a
   * caller can tell "empty" from "unknown".
   */
  const readTokenState = useCallback(async (token, owner = account) => {
    if (!token || !owner) return { balance: 0n, allowance: 0n };
    const erc20 = new ethers.Contract(token, ERC20_ABI, readProvider());
    const [balance, allowance] = await Promise.all([
      erc20.balanceOf(owner),
      erc20.allowance(owner, V4_REGISTRY),
    ]);
    return { balance, allowance };
  }, [account, readProvider]);

  /** Balances of every accepted stablecoin, so the UI can pay with whichever one the user holds. */
  const readStablecoinBalances = useCallback(async (owner = account) => {
    const rows = await Promise.all(STABLECOINS.map(async (t) => ({ ...t, ...(await readTokenState(t.address, owner)) })));
    return rows;
  }, [account, readTokenState]);

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

  // Does `account` satisfy `merchant`'s access policy? Used to pre-gate the
  // subscribe button instead of letting createSubscription revert.
  const checkMerchantPolicy = useCallback(async (merchant) => {
    const reg = readRegistry();
    if (!reg || !merchant || !account) return { gate: 0, meets: true };
    try {
      const [g] = await reg.getMerchantGate(merchant);
      const meets = await reg.meetsMerchantPolicy(merchant, account);
      return { gate: Number(g), meets };
    } catch {
      return { gate: 0, meets: true };
    }
  }, [readRegistry, account]);

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
    reputationGateAvailable, idGateAvailable, checkMerchantPolicy, claimable, claimableGross, merchantVerified, kycRequired,
    loaded: Boolean(current),
    loadFailed: Boolean(account) && loadFailedFor === account,
    tokenAddress, ensureAllowance, readTokenState, readStablecoinBalances, readProvider,
    readSubscription, readSubscriberSubscriptions, readSpendCap, reapprove, ensureWalletChain,
    refresh, fetchReputation, fetchReputationAttestation, submitAttestation, verifyReputation,
    createSubscription, setSpendCap, clearSpendCap, setMerchantPolicy,
    claimStream, terminateStream, openDispute,
  };
}
