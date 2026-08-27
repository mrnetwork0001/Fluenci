import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "./DashboardShell";
import SubscriberDashboard from "./SubscriberDashboard";
import NewSubscription from "./NewSubscription";
import SpendingLimits from "./SpendingLimits";
import MerchantDashboardV2 from "./MerchantDashboardV2";
import Protect from "./Protect";
import Swap from "./Swap";
import { EmptyState } from "./DashboardShell";
import { IconStore } from "./icons";
import { useFluenciV4 } from "./useFluenciV4";
import ConnectWalletV2 from "./ConnectWalletV2";
import TransactionModal from "../components/TransactionModal";
import { resolveQieName } from "./qieName";
import { GATE, QUSDC_DECIMALS, MAINNET_RPC, QIE_PASS, QIE_PASS_ABI, V4_TOKEN } from "./v4Config";
import { sampleSubscriptions, sampleLimits, sampleActivity, sampleMerchant } from "./sampleData";
import { ethers } from "ethers";
import { API_BASE_URL } from "../config";

/**
 * Container for the v2 dashboard: owns role and navigation state, and connects
 * the four screens to chain data.
 *
 * Until VITE_REGISTRY_V4_ADDRESS is set, v4 is not deployed anywhere, so the
 * screens render review fixtures behind an explicit banner. That keeps the UI
 * reviewable now without ever presenting sample numbers as real.
 */
export default function DashboardV2({ fluenci, initialRole = "subscriber", initialTab = "dashboard", onHome, payMerchant = "" }) {
  const [role, setRole] = useState(initialRole);
  const [active, setActive] = useState(initialTab);
  const [collapsed, setCollapsed] = useState(false);
  const [merchantPreview, setMerchantPreview] = useState(null);

  const account = fluenci?.account ?? null;
  // Deliberately NOT fluenci.contracts.qusdc: that map falls back to the
  // mainnet entry on an unknown chain, so a local deploy streamed a token
  // the local registry has never seen.
  const tokenAddress = V4_TOKEN;

  const v4 = useFluenciV4({ account, tokenAddress });
  const usingSample = !v4.configured;

  // Reset the nav when switching roles: the two role navs share only some keys.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setActive("dashboard");
  }, [role]);

  const subscriptions = usingSample ? sampleSubscriptions : v4.subscriptions;
  const limits = usingSample ? sampleLimits : v4.limits;

  // SubscriberDashboard reads each row's cap off `sub.cap` - that is how the
  // review fixtures are shaped. v4 keeps caps in a separate per-merchant array,
  // so without this join the "Spending limit" column read "No limit set" for
  // every live subscription, the "merchants capped" stat sat at 0, and a row at
  // its ceiling could never show the Capped pill.
  const capsByMerchant = useMemo(() => {
    const byMerchant = new Map();
    for (const cap of limits || []) {
      if (cap?.merchant) byMerchant.set(String(cap.merchant).toLowerCase(), cap);
    }
    return byMerchant;
  }, [limits]);

  const subscriptionRows = useMemo(
    () => (subscriptions || []).map((s) =>
      s?.cap ? s : { ...s, cap: capsByMerchant.get(String(s?.merchant || "").toLowerCase()) ?? null }),
    [subscriptions, capsByMerchant]
  );

  const fmt = (v) => ethers.formatUnits(v ?? 0n, QUSDC_DECIMALS);

  // fluenci.qusdcBalance is a formatted string; the screens take raw base units.
  const walletUnits = useMemo(() => {
    const raw = fluenci?.qusdcBalance;
    if (raw === undefined || raw === null || raw === "") return null;
    try { return ethers.parseUnits(String(raw), QUSDC_DECIMALS); } catch { return null; }
  }, [fluenci?.qusdcBalance]);

  // --- wallet ---------------------------------------------------------------
  const [walletOpen, setWalletOpen] = useState(false);

  // Reverse-resolve the connected wallet to its primary .qie name via QIE's own
  // resolver - one eth_call, rather than v1's explorer calldata scrape.
  const [qieName, setQieName] = useState(null);
  useEffect(() => {
    let live = true;
    if (!account) { setQieName(null); return; }
    const rpc = import.meta.env.VITE_V4_RPC_URL && import.meta.env.VITE_V4_RPC_URL.includes("127.0.0.1")
      ? "https://rpc1mainnet.qie.digital"   // names live on mainnet, not the local chain
      : (import.meta.env.VITE_V4_RPC_URL || "https://rpc1mainnet.qie.digital");
    resolveQieName(account, new ethers.JsonRpcProvider(rpc)).then((n) => { if (live) setQieName(n); });
    return () => { live = false; };
  }, [account]);

  // Close the picker as soon as a wallet actually lands.
  useEffect(() => { if (account) setWalletOpen(false); }, [account]);

  // Keep the address bar in step with the sidebar, so tabs are linkable and
  // the back button behaves.
  const navigate = useCallback((key) => {
    setActive(key);
    const path = { dashboard: role === "merchant" ? "/merchants" : "/subscription",
                   protect: "/security", swap: "/swap", limits: "/limits" }[key];
    if (path && window.location.pathname !== path) window.history.pushState({}, "", path);
  }, [role]);

  // --- swap quote ---------------------------------------------------------
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const quoteSeq = useRef(0);

  const requestQuote = useCallback(async ({ from, amount }) => {
    const seq = ++quoteSeq.current;
    if (!amount || Number(amount) <= 0) { setQuote(null); setQuoting(false); return; }
    setQuoting(true);
    const result = await fluenci?.quoteSwap?.(from === "qUSDC" ? "QUSDC" : "QIE", amount);
    // Ignore a quote that arrived after a newer keystroke.
    if (seq !== quoteSeq.current) return;
    setQuote(result);
    setQuoting(false);
  }, [fluenci]);

  // --- Protect telemetry, wallet-scoped -----------------------------------
  const [protect, setProtect] = useState({ online: false, events: [], systemRisk: 0 });
  useEffect(() => {
    if (!API_BASE_URL) return;
    let live = true;
    const pull = async () => {
      try {
        const q = account ? `?wallet=${account}` : "";
        const res = await fetch(`${API_BASE_URL}/telemetry${q}`);
        if (!res.ok) throw new Error("offline");
        const data = await res.json();
        if (!live) return;
        setProtect({
          online: true,
          events: (Array.isArray(data) ? data : data.logs || []).slice(-40).reverse(),
          systemRisk: typeof data?.systemRiskScore === "number" ? data.systemRiskScore : 0,
        });
      } catch {
        if (live) setProtect((p) => ({ ...p, online: false }));
      }
    };
    pull();
    const t = setInterval(pull, 10000);
    return () => { live = false; clearInterval(t); };
  }, [account]);

  // --- merchant lookup for the create flow --------------------------------
  // NewSubscription expects an ADDRESS back from this callback - returning the
  // preview object made ethers.isAddress() false and the field reported
  // "not found" even when resolution had succeeded.
  const resolveMerchant = useCallback(async (input) => {
    const name = (input || "").trim();
    if (!name) return null;
    if (ethers.isAddress(name)) return ethers.getAddress(name);
    const resolved = await fluenci?.resolveQieDomain?.(name);
    if (!resolved || resolved === ethers.ZeroAddress) return null;
    return ethers.getAddress(resolved);
  }, [fluenci]);

  // Identity for the card is gathered once the field has settled on an address.
  const handleMerchantChange = useCallback(async (address, typed) => {
    if (!address) { setMerchantPreview(null); return; }
    const base = {
      address,
      name: typed && !ethers.isAddress(typed) ? typed : null,
      qiePassVerified: false,
      reputation: null,
      tier: null,
      streamingSince: null,
    };
    setMerchantPreview(base);

    const identityProvider = new ethers.JsonRpcProvider(MAINNET_RPC);

    // QIE Pass status was previously hardcoded false and never queried, so every
    // merchant read "Not verified" regardless of their actual status.
    try {
      const pass = new ethers.Contract(QIE_PASS, QIE_PASS_ABI, identityProvider);
      const verified = await pass.verifyIdentity(address);
      setMerchantPreview((m) => (m && m.address === address ? { ...m, qiePassVerified: Boolean(verified) } : m));
    } catch {
      // Leave it false; an unreachable adapter must not read as verified.
    }

    // If the merchant has a primary .qie name, prefer it over what was typed.
    if (!base.name) {
      const primary = await resolveQieName(address, identityProvider);
      if (primary) setMerchantPreview((m) => (m && m.address === address ? { ...m, name: primary } : m));
    }

    const rep = await v4.fetchReputation(address);
    if (rep) setMerchantPreview((m) => (m && m.address === address
      ? { ...m, reputation: rep.score ?? null, tier: rep.tier ?? null } : m));
  }, [v4]);

  // --- actions -------------------------------------------------------------
  const handleCreate = useCallback(async ({ merchant, amountPerPeriod, periodSeconds, spendCap }) => {
    if (usingSample) return;
    // Cap first. setSpendCap does not need the subscription to exist, and the
    // screen promises the merchant "can never draw more than this" - creating
    // first left the stream live and uncapped between two wallet prompts, and
    // permanently uncapped if the second was rejected or reverted.
    if (spendCap?.maxAmount) {
      const capped = await v4.setSpendCap(merchant, spendCap.maxAmount, spendCap.periodSeconds ?? periodSeconds);
      if (!capped) return;
    }
    const ok = await v4.createSubscription({ merchant, amountPerPeriod, periodSeconds, token: tokenAddress });
    if (ok) setActive("dashboard");
  }, [usingSample, v4]);

  const guard = (fn) => (...args) => { if (!usingSample) return fn(...args); };

  const shell = {
    role, onRoleChange: setRole,
    active, onNavigate: navigate,
    collapsed, onToggleCollapse: () => setCollapsed((c) => !c),
    account,
    qusdcBalance: fluenci?.qusdcBalance ?? (usingSample ? "248.60" : "0.00"),
    networkOk: fluenci?.chainId === 1990,
    networkLabel: fluenci?.chainId === 1990 ? "QIE Mainnet" : "Wrong network",
    domainName: fluenci?.accountDomain ?? null,
    qieName,
    onHome,
    onConnect: () => setWalletOpen(true),
    onDisconnect: () => fluenci?.disconnectWallet?.(),
  };

  const banner = usingSample ? (
    <div className="fl-inner" style={{ padding: "12px 16px", marginBottom: 22, borderColor: "var(--fl-warn)" }}>
      <span style={{ color: "var(--fl-warn)", fontSize: 12.5, fontWeight: 600 }}>Preview data</span>
      <span style={{ color: "var(--fl-fg-3)", fontSize: 12.5, marginLeft: 8 }}>
        FluenciRegistryV4 is not deployed yet. These screens show sample figures so the interface can be
        reviewed; set VITE_REGISTRY_V4_ADDRESS to read live data.
      </span>
    </div>
  ) : null;

  const merchantData = usingSample
    ? sampleMerchant
    : {
        claimable: v4.claimable,
        monthlyRecurring: v4.merchantStreams.reduce(
          (a, s) => a + (s.periodSeconds ? (s.amountPerPeriod * 2592000n) / BigInt(s.periodSeconds) : 0n), 0n),
        settledAllTime: v4.merchantStreams.reduce((a, s) => a + (s.settledAmount ?? 0n), 0n),
        subscriberCount: new Set(v4.merchantStreams.map((s) => s.subscriber)).size,
        reputationScore: null,
        merchantName: fluenci?.accountDomain ?? "",
      };

  const screen = useMemo(() => {
    // Shared across both roles: Protect watches streams in either direction, and
    // Swap funds the qUSDC that subscriptions settle in.
    if (active === "protect") {
      return (
        <Protect
          loading={v4.loading}
          online={protect.online}
          systemRisk={protect.systemRisk}
          watchedStreams={subscriptions.length + (v4.merchantStreams?.length ?? 0)}
          pausedByAI={subscriptions.filter((s) => s.pausedByAI).length}
          events={protect.events}
          canConfigure={Boolean(account) && !usingSample}
          // "Review" is navigation, not a write. The screen calls this with no
          // argument - it knows how many streams are held, never which - and
          // useFluenciV4 exposes no resumeStream at all, so the old
          // `v4.resumeStream?.(subId)` was optional-chained into a permanent
          // no-op that would have been handed a click event as its subId.
          onResume={() => setActive(role === "merchant" ? "subscribers" : "dashboard")}
        />
      );
    }

    if (active === "swap") {
      return (
        <Swap
          loading={fluenci?.loading}
          swapping={fluenci?.txState?.status === "preparing" || fluenci?.txState?.status === "broadcasting"}
          qieBalance={fluenci?.qieBalance ?? "0"}
          qusdcBalance={fluenci?.qusdcBalance ?? "0"}
          error={fluenci?.error ?? null}
          quote={quote}
          quoting={quoting}
          onQuote={requestQuote}
          onSwap={({ from, to, amount }) =>
            // Same call v1 makes: FluenciRouter (falling back to QIEDex) over the
            // WQIE <-> qUSDC path, with approval handled for reverse swaps.
            fluenci?.swapQieForTokens?.(from === "qUSDC" ? "QUSDC" : "QIE", to === "qUSDC" ? "QUSDC" : "QIE", amount)}
        />
      );
    }

    if (role === "merchant") {
      switch (active) {
        case "policy":
        case "dashboard":
          return (
            <MerchantDashboardV2
              loading={v4.loading}
              claimable={merchantData.claimable}
              monthlyRecurring={merchantData.monthlyRecurring}
              settledAllTime={merchantData.settledAllTime}
              subscriberCount={merchantData.subscriberCount}
              reputationScore={merchantData.reputationScore}
              qiePassVerified={usingSample ? true : Boolean(v4.merchantVerified)}
              merchantName={merchantData.merchantName}
              gate={v4.policy.gate}
              minReputation={Number(v4.policy.minReputation ?? 700n)}
              reputationGateAvailable={v4.reputationGateAvailable}
              claiming={v4.busy === "claim"}
              savingPolicy={v4.busy === "policy"}
              // Sequential, and awaited. useFluenciV4 has one busy/error slot, so
              // firing these in parallel cleared `claiming` the moment the first
              // one settled while the rest were still in the wallet, and raced N
              // refreshes against each other.
              onClaim={guard(async () => {
                for (const s of v4.merchantStreams) await v4.claimStream(s.id);
              })}
              onSavePolicy={guard((gate, minRep) => v4.setMerchantPolicy(gate, minRep ?? 0))}
              // Copy what the screen displayed and handed over, rather than
              // rebuilding a second URL here that can differ from it.
              onCopyPaymentLink={(url) => navigator.clipboard?.writeText(url)}
              onRegisterName={() => fluenci?.registerQieDomain?.()}
            />
          );
        case "subscribers": {
          const subs = usingSample ? [] : (v4.merchantStreams || []);
          const per = (n) => ({ 60: "minute", 3600: "hour", 86400: "day", 604800: "week", 2592000: "month" }[n] || `${n}s`);
          const money = (v) => `$${Number(ethers.formatUnits(v ?? 0n, QUSDC_DECIMALS)).toFixed(2)}`;
          const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
          const cols = { display: "grid", gridTemplateColumns: "2.2fr 1.1fr 1.3fr 1fr", gap: 16, alignItems: "center" };
          return (
            <>
              <h1 className="fl-title">Subscribers</h1>
              <p className="fl-sub">Everyone currently streaming a payment to you.</p>
              {v4.loading ? (
                <div className="fl-card"><div className="fl-lbl">Loading…</div></div>
              ) : subs.length === 0 ? (
                <EmptyState
                  icon={<IconStore size={26} stroke="#333333" />}
                  title="No subscribers yet"
                  body="When someone opens a subscription to you, they appear here with what they are streaming and what you can claim."
                />
              ) : (
                <div className="fl-card fl-card--flush">
                  <div className="fl-thead" style={cols}>
                    <div className="fl-lbl">Subscriber</div>
                    <div className="fl-lbl">Price</div>
                    <div className="fl-lbl">Claimable</div>
                    <div className="fl-lbl">Status</div>
                  </div>
                  {subs.map((s, i) => (
                    <div key={s.id || i} className="fl-trow" style={cols}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div className="fl-avatar">{(s.subscriber || "?").slice(2, 3).toUpperCase()}</div>
                        <div className="fl-mono" style={{ fontSize: 12.5, color: "var(--fl-fg)" }} title={s.subscriber}>{short(s.subscriber)}</div>
                      </div>
                      <div className="fl-mono" style={{ fontSize: 13 }}>{money(s.amountPerPeriod)}/{per(s.periodSeconds)}</div>
                      <div className="fl-mono fl-stat-value--accent" style={{ fontSize: 13 }}>{money(s.owed || 0n)}</div>
                      <div><span className={`fl-pill ${s.pausedByAI ? "fl-pill--warn" : "fl-pill--on"}`}>{s.pausedByAI ? "Paused" : "Active"}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        }
        default:
          return <MerchantDashboardV2 loading={v4.loading} />;
      }
    }

    switch (active) {
      case "subscriptions":
        return (
          <NewSubscription
            submitting={v4.busy === "create"}
            error={v4.error}
            merchant={merchantPreview}
            reputation={merchantPreview?.reputation ?? null}
            tokenAddress={tokenAddress}
            protocolFeeBps={v4.protocolFeeBps}
            resolveMerchant={resolveMerchant}
            onMerchantChange={handleMerchantChange}
            initialMerchant={payMerchant}
            onSubmit={handleCreate}
            onBack={() => setActive("dashboard")}
            onBrowseMerchants={() => setActive("merchants")}
          />
        );
      case "limits":
        return (
          <SpendingLimits
            loading={v4.loading}
            limits={limits}
            savingMerchant={v4.busy?.startsWith("cap:") ? v4.busy.slice(4) : null}
            onSetCap={guard((merchant, maxAmount, periodSeconds) => v4.setSpendCap(merchant, maxAmount, periodSeconds))}
            onClearCap={guard((merchant) => v4.clearSpendCap(merchant))}
            onBrowseMerchants={() => setActive("merchants")}
          />
        );
      case "merchants":
        return (
          <EmptyState
            icon={<IconStore size={26} stroke="#333333" />}
            title="Merchant directory is not built yet"
            body="Discovering verified businesses that accept Fluenci is the next phase. For now, subscribe using a merchant's .qie name directly."
            actionLabel="Start a subscription"
            onAction={() => setActive("subscriptions")}
          />
        );
      default:
        return (
          <SubscriberDashboard
            loading={v4.loading}
            qusdcBalance={walletUnits ?? (usingSample ? BigInt(248_600_000) : 0n)}
            subscriptions={subscriptionRows}
            activity={usingSample ? sampleActivity : []}
            onNewSubscription={() => setActive("subscriptions")}
            onSetLimit={() => setActive("limits")}
            onClearLimit={guard((sub) => v4.clearSpendCap(sub.merchant))}
            onOpenDispute={guard((sub) => v4.openDispute(sub.id))}
            onCancel={guard((sub) => v4.terminateStream(sub.id))}
          />
        );
    }
  }, [role, active, v4, subscriptions, subscriptionRows, limits, merchantPreview, merchantData, protect, quote, quoting,
      requestQuote, usingSample, tokenAddress, fluenci, account, walletUnits, handleCreate, resolveMerchant]);

  return (
    <>
      <DashboardShell {...shell}>
        {banner}
        {screen}
      </DashboardShell>
      <ConnectWalletV2
        isOpen={walletOpen}
        onClose={() => setWalletOpen(false)}
        announcedProviders={fluenci?.announcedProviders ?? []}
        connectWallet={fluenci?.connectWallet}
        connectWalletConnect={fluenci?.connectWalletConnect}
        loading={fluenci?.loading}
      />
      <TransactionModal
        txState={v4.txState && v4.txState.status !== "idle" ? v4.txState : fluenci?.txState}
        onClose={v4.txState && v4.txState.status !== "idle" ? v4.resetTx : fluenci?.resetTx}
      />
    </>
  );
}
