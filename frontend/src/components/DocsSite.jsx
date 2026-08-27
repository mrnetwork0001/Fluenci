import React, { useState, useEffect, useRef, useCallback } from "react";
import { Copy, Check, ExternalLink, Github, ArrowUpRight } from "lucide-react";
import LogoImage from "../assets/logo.png";

/**
 * Standalone Fluenci documentation site.
 *
 * Full-page, dark, self-contained (its own scoped <style> so it renders
 * correctly whether or not the dashboard theme CSS is loaded). It mirrors the
 * app's design system exactly - black ground, teal #079AB7 accent, JetBrains
 * Mono for onchain values - and lays the content out like a proper docs portal:
 * a sticky, scroll-spied sidebar beside a single readable column.
 *
 * Every address in "Where everything lives" is the live QIE mainnet deployment,
 * verified onchain; each is copyable and links straight to the explorer.
 */

const EXPLORER = "https://mainnet.qie.digital";
const RPC = "https://rpc1mainnet.qie.digital";
const GITHUB = "https://github.com/mrnetwork0001/Fluenci";
const X_URL = "https://x.com/fluenciAI";

const CONTRACTS = {
  registry: "0xCc92ab9B5D973ad9598C53aC28350C34895a2e33",
  attestor: "0x1e89d42C5459b4E8e26b4991DA0f7E0C97CD33B7",
  qieId: "0x5624b5feB42C7100165E70A33a6e1696F4EA96E0",
  qiePass: "0x0766Ff824376CEf38CFa5C155A51E90578096e38",
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
};

const NAV = [
  {
    label: "Getting Started",
    items: [
      { id: "welcome", title: "Welcome to Fluenci" },
      { id: "how", title: "How It Works" },
    ],
  },
  {
    label: "Protocol",
    items: [
      { id: "pricing", title: "Subscriptions & Pricing" },
      { id: "caps", title: "Spending Caps" },
      { id: "settlement", title: "Resolution & Settlement" },
    ],
  },
  {
    label: "Access & Trust",
    items: [
      { id: "gating", title: "Merchant Gating" },
      { id: "protect", title: "Fluenci Protect" },
    ],
  },
  {
    label: "Reference",
    items: [{ id: "contracts", title: "Contracts & Addresses" }],
  },
  {
    label: "Trust",
    items: [{ id: "trust", title: "Trust Model & FAQ" }],
  },
];

const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Monospace address chip: copies on click, links to the explorer. */
function Address({ addr }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    try {
      navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked - the explorer link still works */ }
  }, [addr]);
  return (
    <span className="fdoc-addr-wrap">
      <button type="button" className="fdoc-addr" onClick={copy} title="Copy address">
        <span>{short(addr)}</span>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <a
        className="fdoc-addr-ext"
        href={`${EXPLORER}/address/${addr}`}
        target="_blank"
        rel="noopener noreferrer"
        title="View on explorer"
      >
        <ExternalLink size={12} />
      </a>
    </span>
  );
}

/** One row of the "Where everything lives" table. */
function LiveRow({ label, children, strong }) {
  return (
    <div className="fdoc-live-row">
      <div className={`fdoc-live-label${strong ? " strong" : ""}`}>{label}</div>
      <div className="fdoc-live-val">{children}</div>
    </div>
  );
}

export default function DocsSite({ onHome, onApp }) {
  const [active, setActive] = useState("welcome");
  const observer = useRef(null);

  // Scroll-spy: keep a persistent map of which sections are intersecting across
  // callbacks (each callback only carries the entries that just changed), then
  // pick the topmost still-visible section in document order. This avoids the
  // flicker of judging by a single batch during fast scrolls.
  useEffect(() => {
    const seen = new Map();
    const opts = { rootMargin: "-96px 0px -65% 0px", threshold: 0 };
    observer.current = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
      const current = ALL_IDS.find((id) => seen.get(id));
      if (current) setActive(current);
    }, opts);
    ALL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.current.observe(el);
    });
    return () => observer.current && observer.current.disconnect();
  }, []);

  const jump = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    }
  };

  return (
    <div className="fdoc-root">
      <style>{FDOC_CSS}</style>

      {/* Header */}
      <header className="fdoc-header">
        <div className="fdoc-brand" onClick={onHome} title="Back to Fluenci">
          <img src={LogoImage} alt="Fluenci" />
          <div className="fdoc-brand-txt">
            <strong>Fluenci</strong>
            <span>Docs</span>
          </div>
        </div>
        <nav className="fdoc-topnav">
          <button type="button" onClick={onApp}>App</button>
          <button type="button" onClick={onHome}>Home</button>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href={X_URL} target="_blank" rel="noopener noreferrer">X</a>
        </nav>
      </header>

      <div className="fdoc-body">
        {/* Sidebar */}
        <aside className="fdoc-side">
          {NAV.map((group) => (
            <div className="fdoc-group" key={group.label}>
              <div className="fdoc-group-label">{group.label}</div>
              {group.items.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`fdoc-link${active === item.id ? " active" : ""}`}
                  onClick={(e) => jump(e, item.id)}
                >
                  {item.title}
                </a>
              ))}
            </div>
          ))}
        </aside>

        {/* Content */}
        <main className="fdoc-main">
          {/* WELCOME */}
          <section id="welcome" className="fdoc-section">
            <span className="fdoc-eyebrow">Getting Started</span>
            <h1 className="fdoc-h1">Welcome to Fluenci</h1>
            <p className="fdoc-lead">
              <strong>Fluenci is Stripe-style subscriptions for Web3, live on QIE Blockchain.</strong>{" "}
              Merchants price a plan in plain language &mdash; <em>$20/month</em>, not tokens per
              second &mdash; and subscribers approve once, set a spending cap only they can raise, and
              cancel any time.
            </p>
            <p className="fdoc-p">
              Settlement is pull-based: nothing is escrowed or locked. Funds stay in the
              subscriber&rsquo;s wallet and move only when a merchant claims the time that has already
              accrued, and every claim is clamped to the subscriber&rsquo;s cap. An onchain policy
              lets each merchant decide who may subscribe, and <strong>Fluenci Protect</strong>
              {" "}watches every active stream for anomalies before any funds move.
            </p>
            <ul className="fdoc-bullets">
              <li><strong>A price you can read</strong> &mdash; $20 a month means $20.</li>
              <li><strong>A cap only you can raise</strong> &mdash; approvals with a ceiling, enforced onchain.</li>
              <li><strong>A merchant with a name</strong> &mdash; addresses resolve to their <code>.qie</code> name before you agree to pay.</li>
            </ul>
          </section>

          {/* HOW IT WORKS */}
          <section id="how" className="fdoc-section">
            <h2 className="fdoc-h2">How It Works</h2>
            <p className="fdoc-p">Four steps, start to finish &mdash; the whole lifecycle of a subscription.</p>
            <ol className="fdoc-steps">
              <li>
                <span className="fdoc-step-n">1</span>
                <div>
                  <strong>Subscribe.</strong> Pick a plan, approve qUSDC once, and set a spending cap.
                  If the merchant gates access, the policy is checked before the subscription is created.
                </div>
              </li>
              <li>
                <span className="fdoc-step-n">2</span>
                <div>
                  <strong>Stream.</strong> Time accrues by the second against the plan&rsquo;s amount and
                  period. Nothing leaves your wallet yet &mdash; the balance owed is simply tracked onchain.
                </div>
              </li>
              <li>
                <span className="fdoc-step-n">3</span>
                <div>
                  <strong>Claim.</strong> The merchant withdraws what has accrued, minus a small protocol
                  fee. The claim is clamped to your cap and gated on the merchant holding a verified QIE Pass.
                </div>
              </li>
              <li>
                <span className="fdoc-step-n">4</span>
                <div>
                  <strong>Cancel.</strong> Cancelling freezes accrual instantly. You owe only the final
                  settled amount for time already streamed &mdash; never a second more.
                </div>
              </li>
            </ol>
          </section>

          {/* PRICING */}
          <section id="pricing" className="fdoc-section">
            <span className="fdoc-eyebrow">Protocol</span>
            <h2 className="fdoc-h2">Subscriptions & Pricing</h2>
            <p className="fdoc-p">
              A Fluenci plan is stored as an <strong>amount</strong> and a <strong>period</strong> &mdash;
              for example, $20.00 every 30 days &mdash; not as a rate per second. The subscription accrues
              continuously between claims, but the number you agree to is the number you pay.
            </p>
            <p className="fdoc-p">
              This matters because per-second pricing never adds up cleanly. The earlier design billed a
              &ldquo;$20/month&rdquo; plan as $18.14 and could not represent $1/month at all. Fluenci fixes
              that by pricing in whole amounts over real periods, so <strong>$20 a month means $20</strong>.
            </p>
            <div className="fdoc-callout">
              Prices are quoted and settled in <strong>qUSDC</strong>, a dollar-denominated stable unit on
              QIE. The consumer never has to think in tokens per second.
            </div>
          </section>

          {/* CAPS */}
          <section id="caps" className="fdoc-section">
            <h2 className="fdoc-h2">Spending Caps</h2>
            <p className="fdoc-p">
              Every subscriber can set a ceiling on what a given merchant is allowed to draw &mdash; say
              <strong> $20 per month</strong>. The cap is enforced onchain, per merchant, and shared across
              all of your streams to that merchant.
            </p>
            <p className="fdoc-p">
              A claim above the cap is <strong>clamped down to the cap, never reverted</strong>. The merchant
              simply receives up to the ceiling for the window; the remainder waits for the next window. And
              the contract will not raise a cap for anyone but you &mdash; not the merchant, not the protocol.
            </p>
          </section>

          {/* SETTLEMENT */}
          <section id="settlement" className="fdoc-section">
            <h2 className="fdoc-h2">Resolution & Settlement</h2>
            <p className="fdoc-p">
              Settlement is pull-based and non-custodial. When a merchant claims, the contract settles the
              time accrued since the last claim, deducts the protocol fee, and clamps the payout to the
              subscriber&rsquo;s cap. Nothing is ever held in escrow.
            </p>
            <p className="fdoc-p">
              <strong>Cancelling</strong> stamps a stop time: accrual freezes immediately and the
              subscription carries a single final charge for the merchant to claim, then closes once it is
              settled. Disputes route through the same cap-and-fee accounting, so a contested stream can be
              paused without stranding funds on either side.
            </p>
          </section>

          {/* GATING */}
          <section id="gating" className="fdoc-section">
            <span className="fdoc-eyebrow">Access & Trust</span>
            <h2 className="fdoc-h2">Merchant Gating</h2>
            <p className="fdoc-p">
              Each merchant chooses a single access policy for their plans. The gate is checked before a
              subscription is created &mdash; and it only ever returns a pass/fail, never any underlying
              identity data.
            </p>
            <div className="fdoc-table">
              <div className="fdoc-tr fdoc-th">
                <div>Policy</div><div>What it requires</div><div>Status</div>
              </div>
              <div className="fdoc-tr">
                <div><strong>Open</strong></div>
                <div>Anyone can subscribe. No KYC. The default.</div>
                <div><span className="fdoc-pill on">Live</span></div>
              </div>
              <div className="fdoc-tr">
                <div><strong>QIE ID required</strong></div>
                <div>Subscriber must hold a registered <code>.qie</code> name.</div>
                <div><span className="fdoc-pill on">Live</span></div>
              </div>
              <div className="fdoc-tr">
                <div><strong>QIE Pass verified</strong></div>
                <div>Subscriber must hold a verified QIE Pass.</div>
                <div><span className="fdoc-pill on">Live</span></div>
              </div>
              <div className="fdoc-tr">
                <div><strong>Minimum reputation</strong></div>
                <div>Signed reputation attestation above a threshold.</div>
                <div><span className="fdoc-pill wait">Pending signer</span></div>
              </div>
            </div>
            <p className="fdoc-note">
              Reputation gating is fully built &mdash; a signed attestation verified against an upgradeable
              authorised signer &mdash; and switches on the moment QIE&rsquo;s reputation signing key is live.
            </p>
          </section>

          {/* PROTECT */}
          <section id="protect" className="fdoc-section">
            <h2 className="fdoc-h2">Fluenci Protect</h2>
            <p className="fdoc-p">
              Protect is the safety layer that watches every active subscription. It flags anomalous billing
              behaviour and can pause a suspicious stream <strong>before any funds move</strong> &mdash; a
              pause blocks payout, it never seizes a subscriber&rsquo;s balance.
            </p>
            <p className="fdoc-p">
              Protect also enforces <strong>progressive KYC</strong>: merchants must hold a verified QIE Pass
              before they can withdraw. Subscribing stays permissionless; the verification requirement sits on
              the payout side, where it belongs.
            </p>
          </section>

          {/* CONTRACTS */}
          <section id="contracts" className="fdoc-section">
            <span className="fdoc-eyebrow">Reference</span>
            <h2 className="fdoc-h2">Contracts & Addresses</h2>
            <p className="fdoc-p">
              Everything below is the live deployment on <strong>QIE Mainnet (chain&nbsp;1990)</strong>. Every
              settlement is an onchain transaction anyone can verify.
            </p>

            <h3 className="fdoc-h3">Where everything lives</h3>
            <div className="fdoc-live">
              <LiveRow label="Live app">
                <a className="fdoc-a" href="https://fluenci.xyz" target="_blank" rel="noopener noreferrer">
                  fluenci.xyz <ArrowUpRight size={12} />
                </a>
              </LiveRow>
              <LiveRow label="Payment links">
                <span className="fdoc-mono-inline">fluenci.xyz/pay/&lt;merchant.qie&gt;</span>
              </LiveRow>
              <LiveRow label="Registry (chain 1990)" strong>
                <Address addr={CONTRACTS.registry} />
                <span className="fdoc-dim"> deploy block 10,031,931</span>
              </LiveRow>
              <LiveRow label="Reputation attestor">
                <Address addr={CONTRACTS.attestor} />
              </LiveRow>
              <LiveRow label="QIE ID adapter">
                <Address addr={CONTRACTS.qieId} />
              </LiveRow>
              <LiveRow label="QIE Pass adapter">
                <Address addr={CONTRACTS.qiePass} />
              </LiveRow>
              <LiveRow label="qUSDC token">
                <Address addr={CONTRACTS.qusdc} />
              </LiveRow>
              <LiveRow label="RPC endpoint">
                <a className="fdoc-a" href={RPC} target="_blank" rel="noopener noreferrer">
                  rpc1mainnet.qie.digital <ArrowUpRight size={12} />
                </a>
              </LiveRow>
              <LiveRow label="Explorer">
                <a className="fdoc-a" href={EXPLORER} target="_blank" rel="noopener noreferrer">
                  mainnet.qie.digital <ArrowUpRight size={12} />
                </a>
              </LiveRow>
              <LiveRow label="GitHub">
                <a className="fdoc-a" href={GITHUB} target="_blank" rel="noopener noreferrer">
                  mrnetwork0001/Fluenci <ArrowUpRight size={12} />
                </a>
              </LiveRow>
              <LiveRow label="X">
                <a className="fdoc-a" href={X_URL} target="_blank" rel="noopener noreferrer">
                  @fluenciAI <ArrowUpRight size={12} />
                </a>
              </LiveRow>
            </div>
          </section>

          {/* TRUST */}
          <section id="trust" className="fdoc-section">
            <span className="fdoc-eyebrow">Trust</span>
            <h2 className="fdoc-h2">Trust Model & FAQ</h2>
            <p className="fdoc-p">
              Fluenci is non-custodial: there is no escrow and no pooled balance. Funds sit in your wallet
              until a merchant pulls what they have already earned, bounded by a cap only you can raise. The
              contracts were hardened across three adversarial audit rounds and the source is public.
            </p>
            <div className="fdoc-faq">
              <div className="fdoc-qa">
                <div className="fdoc-q">Can a merchant drain my wallet?</div>
                <div className="fdoc-p">No. Every claim is clamped to your spending cap, and the merchant can never raise it.</div>
              </div>
              <div className="fdoc-qa">
                <div className="fdoc-q">What happens the instant I cancel?</div>
                <div className="fdoc-p">Accrual stops immediately. You owe only the final settled amount for time already streamed.</div>
              </div>
              <div className="fdoc-qa">
                <div className="fdoc-q">Is my identity exposed by a gate?</div>
                <div className="fdoc-p">No. A gate returns only pass or fail &mdash; never KYC data, a score, or any underlying record.</div>
              </div>
              <div className="fdoc-qa">
                <div className="fdoc-q">Where is the money actually held?</div>
                <div className="fdoc-p">In your own wallet, the whole time. Nothing is locked in the contract to begin streaming.</div>
              </div>
            </div>
            <div className="fdoc-cta">
              <button type="button" className="fdoc-btn primary" onClick={onApp}>Open the app</button>
              <a className="fdoc-btn ghost" href={GITHUB} target="_blank" rel="noopener noreferrer">
                <Github size={15} /> View the source
              </a>
            </div>
          </section>

          <footer className="fdoc-foot">
            &copy; 2026 Fluenci Protocol &middot; Subscriptions on QIE Blockchain
          </footer>
        </main>
      </div>
    </div>
  );
}

const FDOC_CSS = `
.fdoc-root{
  --bg:#000000; --card:#0a0a0a; --raised:#111111; --border:#1a1a1a; --border-hi:#242424;
  --fg:#ffffff; --fg2:#a1a1a6; --fg3:#6c6c74; --accent:#079AB7; --accent-soft:rgba(7,154,183,0.12);
  --warn:#f59e0b; --mono:'JetBrains Mono','Fira Code',ui-monospace,monospace;
  --sans:'Inter','Mulish',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --display:'Montserrat',var(--sans);
  min-height:100vh; background:var(--bg); color:var(--fg2);
  font-family:var(--sans); -webkit-font-smoothing:antialiased;
  background-image:
    linear-gradient(rgba(255,255,255,0.018) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,0.018) 1px,transparent 1px);
  background-size:64px 64px; background-position:center top;
}
.fdoc-header{
  position:sticky; top:0; z-index:20;
  display:flex; align-items:center; justify-content:space-between;
  padding:16px 32px; border-bottom:1px solid var(--border);
  background:rgba(0,0,0,0.72); backdrop-filter:blur(12px);
}
.fdoc-brand{display:flex; align-items:center; gap:11px; cursor:pointer;}
.fdoc-brand img{width:34px; height:34px; border-radius:9px; border:1px solid var(--border-hi);}
.fdoc-brand-txt{display:flex; align-items:baseline; gap:9px;}
.fdoc-brand-txt strong{font-family:var(--display); font-weight:800; font-size:1.12rem; color:var(--fg); letter-spacing:-0.01em;}
.fdoc-brand-txt span{font-size:0.66rem; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:var(--accent);}
.fdoc-topnav{display:flex; align-items:center; gap:6px;}
.fdoc-topnav a,.fdoc-topnav button{
  font-family:inherit; font-size:0.74rem; font-weight:600; letter-spacing:0.09em; text-transform:uppercase;
  color:var(--fg3); background:none; border:none; cursor:pointer; text-decoration:none;
  padding:8px 12px; border-radius:8px; transition:color .15s, background .15s;
}
.fdoc-topnav a:hover,.fdoc-topnav button:hover{color:var(--fg); background:var(--raised);}

.fdoc-body{
  display:grid; grid-template-columns:236px minmax(0,1fr);
  gap:48px; max-width:1180px; margin:0 auto; padding:0 32px;
  align-items:start;
}
.fdoc-side{
  position:sticky; top:69px; align-self:start;
  max-height:calc(100vh - 69px); overflow-y:auto;
  padding:34px 0 40px; display:flex; flex-direction:column; gap:22px;
}
.fdoc-group{display:flex; flex-direction:column; gap:2px;}
.fdoc-group-label{
  font-size:0.66rem; font-weight:700; letter-spacing:0.16em; text-transform:uppercase;
  color:var(--fg3); padding:0 12px 8px;
}
.fdoc-link{
  font-size:0.86rem; color:var(--fg2); text-decoration:none; padding:7px 12px;
  border-radius:8px; border-left:2px solid transparent; transition:color .14s, background .14s, border-color .14s;
}
.fdoc-link:hover{color:var(--fg); background:var(--raised);}
.fdoc-link.active{
  color:var(--fg); background:var(--accent-soft);
  border-left-color:var(--accent); font-weight:600;
}

.fdoc-main{padding:46px 0 90px; min-width:0;}
.fdoc-section{scroll-margin-top:92px; padding-bottom:34px; margin-bottom:34px; border-bottom:1px solid var(--border);}
.fdoc-section:last-of-type{border-bottom:none;}
.fdoc-eyebrow{
  display:inline-block; font-size:0.68rem; font-weight:700; letter-spacing:0.18em;
  text-transform:uppercase; color:var(--accent); margin-bottom:14px;
}
.fdoc-h1{
  font-family:var(--display); font-weight:800; font-size:2.9rem; line-height:1.04;
  color:var(--fg); letter-spacing:-0.03em; margin:0 0 22px; text-wrap:balance;
}
.fdoc-h2{
  font-family:var(--display); font-weight:800; font-size:1.72rem; line-height:1.12;
  color:var(--fg); letter-spacing:-0.02em; margin:0 0 16px; text-wrap:balance;
}
.fdoc-h3{
  font-family:var(--display); font-weight:700; font-size:1.06rem; color:var(--fg);
  letter-spacing:-0.01em; margin:30px 0 14px;
}
.fdoc-lead{font-size:1.12rem; line-height:1.62; color:var(--fg2); margin:0 0 18px; max-width:68ch;}
.fdoc-p{font-size:0.985rem; line-height:1.72; color:var(--fg2); margin:0 0 16px; max-width:70ch;}
.fdoc-section strong{color:var(--fg); font-weight:600;}
.fdoc-lead em,.fdoc-p em{color:var(--accent); font-style:normal; font-weight:600;}
.fdoc-section code{
  font-family:var(--mono); font-size:0.86em; color:var(--accent);
  background:var(--accent-soft); padding:1px 6px; border-radius:5px;
}

.fdoc-bullets{list-style:none; padding:0; margin:8px 0 4px; display:flex; flex-direction:column; gap:11px; max-width:70ch;}
.fdoc-bullets li{position:relative; padding-left:22px; font-size:0.985rem; line-height:1.6; color:var(--fg2);}
.fdoc-bullets li::before{
  content:""; position:absolute; left:2px; top:9px; width:7px; height:7px; border-radius:50%;
  background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft);
}

.fdoc-steps{list-style:none; padding:0; margin:6px 0; display:flex; flex-direction:column; gap:14px; counter-reset:s;}
.fdoc-steps li{display:flex; gap:16px; align-items:flex-start; font-size:0.985rem; line-height:1.62; max-width:72ch;}
.fdoc-step-n{
  flex:0 0 auto; width:28px; height:28px; border-radius:8px; display:grid; place-items:center;
  font-family:var(--mono); font-size:0.82rem; font-weight:700; color:var(--accent);
  background:var(--accent-soft); border:1px solid rgba(7,154,183,0.25);
}

.fdoc-callout{
  background:var(--card); border:1px solid var(--border); border-left:2px solid var(--accent);
  border-radius:10px; padding:16px 18px; font-size:0.94rem; line-height:1.6; color:var(--fg2);
  margin:6px 0; max-width:70ch;
}
.fdoc-note{font-size:0.88rem; line-height:1.6; color:var(--fg2); margin:14px 0 0; max-width:70ch;}

.fdoc-table{
  border:1px solid var(--border); border-radius:12px; overflow:hidden; margin:8px 0 4px; background:var(--card);
}
.fdoc-tr{display:grid; grid-template-columns:1.1fr 2fr 0.9fr; gap:16px; padding:13px 18px; border-bottom:1px solid var(--border); align-items:center;}
.fdoc-tr:last-child{border-bottom:none;}
.fdoc-th{background:rgba(255,255,255,0.02); font-size:0.68rem; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--fg3);}
.fdoc-tr div{font-size:0.9rem; line-height:1.45; color:var(--fg2);}
.fdoc-tr.fdoc-th div{font-size:0.68rem; color:var(--fg3);}
.fdoc-pill{display:inline-block; font-size:0.7rem; font-weight:700; padding:3px 9px; border-radius:20px; white-space:nowrap;}
.fdoc-pill.on{color:#34d399; background:rgba(16,185,129,0.12);}
.fdoc-pill.wait{color:var(--warn); background:var(--warn-soft,rgba(245,158,11,0.14));}

.fdoc-live{border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--card);}
.fdoc-live-row{display:grid; grid-template-columns:210px minmax(0,1fr); gap:18px; align-items:center; padding:13px 18px; border-bottom:1px solid var(--border);}
.fdoc-live-row:last-child{border-bottom:none;}
.fdoc-live-label{font-size:0.86rem; color:var(--fg3);}
.fdoc-live-label.strong{color:var(--fg); font-weight:600;}
.fdoc-live-val{font-size:0.9rem; color:var(--fg2); display:flex; align-items:center; flex-wrap:wrap; gap:6px;}

.fdoc-addr-wrap{display:inline-flex; align-items:center; gap:4px;}
.fdoc-addr{
  display:inline-flex; align-items:center; gap:7px; font-family:var(--mono); font-size:0.82rem;
  color:var(--fg); background:var(--raised); border:1px solid var(--border-hi); border-radius:7px;
  padding:5px 9px; cursor:pointer; transition:border-color .15s, color .15s;
}
.fdoc-addr:hover{border-color:var(--accent); color:var(--accent);}
.fdoc-addr-ext{display:inline-grid; place-items:center; color:var(--fg3); padding:4px; border-radius:6px; transition:color .15s;}
.fdoc-addr-ext:hover{color:var(--accent);}
.fdoc-dim{color:var(--fg3); font-size:0.82rem;}
.fdoc-mono-inline{font-family:var(--mono); font-size:0.84rem; color:var(--fg2);}
.fdoc-a{color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:500;}
.fdoc-a:hover{text-decoration:underline;}

.fdoc-faq{display:flex; flex-direction:column; gap:2px; margin:6px 0;}
.fdoc-qa{padding:16px 0; border-bottom:1px solid var(--border);}
.fdoc-qa:last-child{border-bottom:none;}
.fdoc-q{font-family:var(--display); font-weight:700; font-size:1rem; color:var(--fg); margin-bottom:7px;}
.fdoc-qa .fdoc-p{margin:0;}

.fdoc-cta{display:flex; gap:12px; flex-wrap:wrap; margin-top:30px;}
.fdoc-btn{
  display:inline-flex; align-items:center; gap:8px; font-family:inherit; font-size:0.9rem; font-weight:600;
  padding:11px 20px; border-radius:10px; cursor:pointer; text-decoration:none; border:1px solid transparent; transition:.15s;
}
.fdoc-btn.primary{background:var(--accent); color:#001417; border-color:var(--accent);}
.fdoc-btn.primary:hover{filter:brightness(1.08);}
.fdoc-btn.ghost{background:transparent; color:var(--fg); border-color:var(--border-hi);}
.fdoc-btn.ghost:hover{border-color:var(--accent); color:var(--accent);}

.fdoc-foot{margin-top:40px; padding-top:24px; border-top:1px solid var(--border); font-size:0.8rem; color:var(--fg3);}

.fdoc-root a:focus-visible,.fdoc-root button:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:6px;}

@media (max-width:900px){
  .fdoc-section{scroll-margin-top:124px;}
  .fdoc-header{padding:14px 18px;}
  .fdoc-body{grid-template-columns:1fr; gap:0; padding:0 18px;}
  .fdoc-side{
    position:sticky; top:63px; max-height:none; overflow-x:auto; overflow-y:hidden;
    flex-direction:row; gap:6px; padding:12px 0; border-bottom:1px solid var(--border);
    background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:15;
  }
  .fdoc-group{flex-direction:row; gap:6px;}
  .fdoc-group-label{display:none;}
  .fdoc-link{white-space:nowrap; border-left:none; border-bottom:2px solid transparent; padding:6px 11px; font-size:0.82rem;}
  .fdoc-link.active{border-left:none; border-bottom-color:var(--accent);}
  .fdoc-main{padding:30px 0 70px;}
  .fdoc-h1{font-size:2.15rem;}
  .fdoc-h2{font-size:1.45rem;}
  .fdoc-tr{grid-template-columns:1fr; gap:6px;}
  .fdoc-live-row{grid-template-columns:1fr; gap:6px; align-items:flex-start;}
  .fdoc-topnav button:nth-child(2){display:none;}
}
`;
