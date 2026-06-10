import React, { useState } from "react";
import {
  ArrowLeft,
  Clock,
  User,
  Share2,
  BookOpen,
  ChevronRight,
  Shield,
  Cpu,
  Coins,
  Gamepad2,
  Globe,
  Zap
} from "lucide-react";

const ARTICLES = [
  {
    id: "ai-protected-streaming",
    title: "Why We Built the First AI-Protected Streaming Payments Protocol on QIE Blockchain",
    excerpt: "There's a $3.5 billion problem hiding in plain sight across every blockchain network that supports recurring payments. Every streaming payment protocol operates completely blind.",
    author: "Fluenci Team",
    date: "June 10, 2026",
    readTime: "8 min read",
    category: "Deep Dive",
    categoryColor: "#2563eb",
    featured: true,
    content: `
There's a $3.5 billion problem hiding in plain sight across every blockchain network that supports recurring payments.

It's not gas fees. It's not scalability. It's not even adoption.

It's the fact that **every streaming payment protocol in existence today operates completely blind.**

When you subscribe to a service using Sablier, Superfluid, or LlamaPay, your tokens flow out of your wallet continuously - every second, every block — with zero oversight. There's no system watching whether the merchant wallet has been compromised. No automated safeguard if someone manipulates the billing rate. No AI monitoring claim patterns for anomalies.

Your only protection? Manually checking your wallet and clicking "cancel" before the damage is done.

That's not security. That's a liability waiting to happen.

**Fluenci was built to eliminate this vulnerability entirely.**

---

## What Is Fluenci?

Fluenci is an **AI-shielded real-time streaming payments protocol** built natively on QIE Blockchain. It enables subscribers to stream QUSDC stablecoins to merchants on a per-second basis — with an autonomous AI Sentry layer that actively monitors every stream, detects anomalies, and freezes suspicious activity onchain without any human intervention.

This isn't a feature we bolted on as an afterthought. The AI protection layer is the foundational architecture that every other component is built around.

At its core, Fluenci asks one simple question: **What if your payment stream could protect itself?**

---

## The Multi-Agent AI Sentry Architecture

Most projects that claim "AI integration" are running a chatbot or an off-chain script that generates alerts. Fluenci operates fundamentally differently.

Our AI Sentry is a **multi-agent system** where four specialized agents work in concert, each responsible for a distinct phase of the security pipeline:

**The Sentry Agent** performs continuous blockchain ingestion and mempool filtering. It watches every block on QIE Mainnet, tracking stream creation events, claim transactions, rate modifications, and wallet behavior patterns. It operates as the first line of detection — the eyes on every transaction.

**The Analyst Agent** runs LLM-powered pricing audits and behavioral analysis. When the Sentry Agent flags unusual activity, the Analyst examines the full context: Is this claim frequency normal for this stream's history? Does this rate change align with the merchant's established pattern? Has the merchant's wallet interacted with known exploit contracts?

**The Decision Agent** holds the authority for autonomous onchain action. If the Analyst confirms an anomaly, the Decision Agent signs and submits a freeze transaction directly to the FluenciAIAuditor smart contract. The stream is paused onchain — meaning no funds can be claimed or withdrawn — within seconds of detection. No human approval needed. No delay.

**The Arbitrator Agent** handles the aftermath. When a stream is frozen, both the subscriber and merchant may have legitimate claims to the streamed funds. The Arbitrator uses EIP-712 typed signatures to calculate fair split ratios based on the evidence, enabling trustless dispute resolution without requiring a centralized mediator.

This entire pipeline — from detection to onchain freeze — executes in under 3 seconds on QIE Blockchain.

---

## Why QIE Blockchain?

We evaluated multiple chains before committing to QIE, and the decision came down to three factors that directly impact streaming payment viability:

**Sub-second block finality.** Streaming payments update balances every second. If your underlying chain takes 12 seconds to confirm a block (like Ethereum L1), your "real-time" stream has 12 seconds of latency — and 12 seconds where an exploit could drain funds before the AI can respond. QIE's block times make sub-second safety pausing possible.

**Negligible gas costs.** Every stream claim, every AI pause, every dispute resolution is an onchain transaction. On Ethereum, the gas costs would make micro-payment streaming economically impossible. On QIE, these operations cost fractions of a cent, making per-second streaming viable for everyday use.

**Native ecosystem infrastructure.** QIE isn't just a chain — it's an ecosystem with native DID (QIE Pass), domain resolution (QIE Domains), stablecoin infrastructure (QUSDC), and DEX liquidity (QIEDex). Fluenci integrates deeply with all of these, rather than rebuilding them from scratch.

---

## Deep Ecosystem Integration

Fluenci doesn't just run on QIE. It's architecturally integrated with the core QIE ecosystem primitives:

**QIE Pass (Decentralized Identity).** Before any streaming agreement can be created, both the subscriber and merchant must hold a verified QIE Pass identity. This prevents Sybil attacks and ensures every participant in the streaming network has completed decentralized KYC verification.

**QIEDex (Attributed Swap Routing).** Users often hold native QIE tokens but need QUSDC stablecoins for streaming. The FluenciRouter contract wraps swap interactions through QIEDex's AMM, converting QIE to QUSDC seamlessly. Every swap emits a FluenciSwap event onchain, creating a fully auditable trail of swap volume attributed to the Fluenci protocol.

**QIE Domains (.qie Resolution).** Instead of displaying raw hexadecimal addresses, Fluenci resolves registered .qie domain names directly from the QIE Domain Registry. Users see human-readable names like mrnetwork.qie throughout the interface.

**QUSDC (Stablecoin Streaming).** All payment streams are denominated in QUSDC to ensure merchants receive stable, predictable value regardless of native token price volatility.

---

## The Fluenci Arcade: Micro-Payments in Action

Beyond the core protocol, we built the Fluenci Arcade to demonstrate real-time micro-payment streams powering interactive experiences.

**Qie Snake Game** — a stream-to-play classic where users insert QUSDC to start a micro-payment stream at 0.0001 QUSDC per second. The game runs as long as the stream flows. When you stop playing, the stream terminates automatically.

**AI Chat Copilot** — a GPT-4o-mini powered conversational assistant, also funded by a per-second payment stream. Users can ask questions about the QIE ecosystem, stream management, and Fluenci features.

This is a proof of concept for an entirely new category: **stream-funded services** where users pay continuously for exactly what they consume, with zero commitment and automatic termination.

---

## Deployed and Operational on QIE Mainnet

Fluenci is not a concept, not a whitepaper, and not a testnet demo.

The following contracts are deployed and operational on QIE Mainnet (Chain ID: 1990):

- **FluenciRegistry** — Core stream orchestration
- **FluenciAIAuditor** — Cryptographic AI safety pausing
- **FluenciRouter** — Attributed swap routing through QIEDex AMM
- **QIE Pass Integration** — Onchain identity gating

Every transaction is publicly verifiable on the QIE Mainnet block explorer.

---

## What's Next for Fluenci

**Phase 2: Subscription Marketplace.** A discovery layer where merchants list services and subscribers browse and start streams — all protected by the AI Sentry.

**Phase 3: Cross-Chain Streaming.** Leveraging QIE bridge infrastructure to enable streams across chains with AI protection.

**Phase 4: Enterprise API.** A developer SDK that allows any application to embed AI-protected recurring payments.

---

## The Bottom Line

The streaming payments space has grown rapidly, but it has grown recklessly. Billions of dollars flow through protocols that offer zero automated protection.

Fluenci exists because we believe the answer isn't better dashboards or faster notifications. The answer is **autonomous onchain AI that acts before the damage is done.**

We're live on QIE Mainnet. The contracts are deployed. The AI is watching.

The question isn't whether streaming payments need protection. The question is why it took this long for someone to build it.
    `
  }
];

// Simple markdown-like renderer
function renderArticleContent(content) {
  const lines = content.trim().split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (line.trim() === "---") {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid #e5e5e5", margin: "28px 0" }} />);
      i++;
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} style={{ fontSize: "1.4rem", fontWeight: "800", color: "#111111", margin: "32px 0 12px 0", lineHeight: "1.3" }}>
          {line.replace("## ", "")}
        </h2>
      );
      i++;
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={{ fontSize: "1.15rem", fontWeight: "700", color: "#111111", margin: "24px 0 8px 0" }}>
          {line.replace("### ", "")}
        </h3>
      );
      i++;
      continue;
    }

    // List item
    if (line.startsWith("- **")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "0.92rem", color: "#444444", lineHeight: "1.6", marginBottom: "6px" }}>
          <span style={{ color: "#2563eb", fontWeight: "bold", flexShrink: 0 }}>-</span>
          <span dangerouslySetInnerHTML={{ __html: formatInline(line.replace("- ", "")) }} />
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} style={{ fontSize: "0.95rem", color: "#444444", lineHeight: "1.75", margin: "0 0 12px 0" }}
        dangerouslySetInnerHTML={{ __html: formatInline(line) }}
      />
    );
    i++;
  }

  return elements;
}

function formatInline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#111111">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:0.85em;color:#2563eb">$1</code>');
}


export default function BlogPage({ onBack }) {
  const [selectedArticle, setSelectedArticle] = useState(null);

  const handleShare = (article) => {
    const text = `${article.title} — by @FluenciAI`;
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: article.title, text, url });
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`);
    }
  };

  // Article detail view
  if (selectedArticle) {
    return (
      <div className="blog-page">
        <div className="blog-article-view">
          {/* Back button */}
          <button
            onClick={() => setSelectedArticle(null)}
            className="blog-back-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#666666",
              fontSize: "0.88rem",
              fontWeight: "600",
              padding: "8px 0",
              marginBottom: "24px",
              transition: "color 0.2s"
            }}
          >
            <ArrowLeft size={18} />
            Back to Blog
          </button>

          {/* Category badge */}
          <span style={{
            display: "inline-block",
            background: `${selectedArticle.categoryColor}15`,
            color: selectedArticle.categoryColor,
            padding: "4px 12px",
            borderRadius: "20px",
            fontSize: "0.75rem",
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "16px"
          }}>
            {selectedArticle.category}
          </span>

          {/* Title */}
          <h1 style={{
            fontSize: "2rem",
            fontWeight: "900",
            color: "#111111",
            lineHeight: "1.25",
            margin: "0 0 16px 0",
            fontFamily: "'Montserrat', sans-serif"
          }}>
            {selectedArticle.title}
          </h1>

          {/* Meta */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "0.82rem",
            color: "#888888",
            marginBottom: "32px",
            flexWrap: "wrap"
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <User size={14} />
              {selectedArticle.author}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={14} />
              {selectedArticle.date}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <BookOpen size={14} />
              {selectedArticle.readTime}
            </span>
            <button
              onClick={() => handleShare(selectedArticle)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#2563eb",
                fontSize: "0.82rem",
                fontWeight: "600"
              }}
            >
              <Share2 size={14} />
              Share
            </button>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #e5e5e5", marginBottom: "32px" }} />

          {/* Article body */}
          <div className="blog-article-body">
            {renderArticleContent(selectedArticle.content)}
          </div>

          {/* Bottom CTA */}
          <div style={{
            marginTop: "48px",
            padding: "28px",
            background: "#111111",
            borderRadius: "16px",
            textAlign: "center"
          }}>
            <h3 style={{ color: "#ffffff", fontSize: "1.2rem", fontWeight: "800", margin: "0 0 8px 0" }}>
              Ready to experience AI-protected payments?
            </h3>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.88rem", margin: "0 0 20px 0" }}>
              Fluenci is live on QIE Mainnet. Try it now.
            </p>
            <button
              onClick={onBack}
              className="btn btn-primary"
              style={{ padding: "12px 28px", fontSize: "0.9rem", borderRadius: "10px" }}
            >
              Launch App
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Blog listing view
  return (
    <div className="blog-page">
      {/* Blog Header */}
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <button
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#666666",
            fontSize: "0.85rem",
            fontWeight: "600",
            marginBottom: "24px"
          }}
        >
          <ArrowLeft size={16} />
          Back to Home
        </button>
        <h1 style={{
          fontSize: "2.5rem",
          fontWeight: "900",
          color: "#111111",
          margin: "0 0 12px 0",
          fontFamily: "'Montserrat', sans-serif"
        }}>
          Fluenci Blog
        </h1>
        <p style={{ fontSize: "1rem", color: "#666666", maxWidth: "500px", margin: "0 auto" }}>
          Deep dives, product updates, and insights on AI-shielded streaming payments
        </p>
      </div>

      {/* Featured Article */}
      {ARTICLES.filter(a => a.featured).map(article => (
        <div
          key={article.id}
          className="blog-featured-card"
          onClick={() => setSelectedArticle(article)}
          style={{
            background: "#ffffff",
            border: "1px solid #e5e5e5",
            borderRadius: "20px",
            padding: "36px",
            marginBottom: "32px",
            cursor: "pointer",
            transition: "all 0.3s ease",
            position: "relative",
            overflow: "hidden"
          }}
        >
          {/* Featured badge */}
          <span style={{
            display: "inline-block",
            background: "#111111",
            color: "#ffffff",
            padding: "4px 12px",
            borderRadius: "20px",
            fontSize: "0.7rem",
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "16px"
          }}>
            Featured
          </span>

          <h2 style={{
            fontSize: "1.6rem",
            fontWeight: "800",
            color: "#111111",
            margin: "0 0 12px 0",
            lineHeight: "1.3"
          }}>
            {article.title}
          </h2>
          <p style={{
            fontSize: "0.95rem",
            color: "#666666",
            lineHeight: "1.6",
            margin: "0 0 20px 0",
            maxWidth: "700px"
          }}>
            {article.excerpt}
          </p>

          {/* Meta row */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "0.8rem",
            color: "#999999"
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={14} />
              {article.date}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <BookOpen size={14} />
              {article.readTime}
            </span>
            <span style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "#2563eb",
              fontWeight: "600"
            }}>
              Read article
              <ChevronRight size={14} />
            </span>
          </div>

          {/* Decorative gradient */}
          <div style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "200px",
            height: "200px",
            background: "radial-gradient(circle at top right, rgba(37, 99, 235, 0.04), transparent 70%)",
            pointerEvents: "none"
          }} />
        </div>
      ))}

      {/* Topic Cards */}
      <div style={{ marginTop: "40px" }}>
        <h3 style={{
          fontSize: "0.8rem",
          fontWeight: "700",
          color: "#999999",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: "16px"
        }}>
          Explore Topics
        </h3>
        <div className="blog-topics-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "12px"
        }}>
          {[
            { icon: <Shield size={20} />, label: "AI Security", color: "#d97706" },
            { icon: <Cpu size={20} />, label: "Multi-Agent AI", color: "#8b5cf6" },
            { icon: <Coins size={20} />, label: "Streaming Payments", color: "#2563eb" },
            { icon: <Gamepad2 size={20} />, label: "Fluenci Arcade", color: "#ec4899" },
            { icon: <Globe size={20} />, label: "QIE Ecosystem", color: "#10b981" },
            { icon: <Zap size={20} />, label: "DeFi Innovation", color: "#f59e0b" }
          ].map((topic, idx) => (
            <div key={idx} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              padding: "20px 12px",
              background: "#ffffff",
              border: "1px solid #e5e5e5",
              borderRadius: "14px",
              transition: "all 0.2s ease",
              cursor: "default"
            }}>
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: `${topic.color}10`,
                color: topic.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {topic.icon}
              </div>
              <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "#555555" }}>
                {topic.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
