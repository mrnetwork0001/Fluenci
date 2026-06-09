import React, { useState, useEffect, useRef } from "react";

const ARCADE_MERCHANT = "0xfe5f1d13a31a5b86833adf4486720331d6e4a6bb";

// Simulated AI response engine — covers Fluenci, QIE, crypto, and general topics
const AI_RESPONSES = [
  { keywords: ["fluenci", "what is", "about"], response: "Fluenci is a decentralized real-time streaming payment protocol on QIE Blockchain. Instead of monthly charges, you pay per second — and an AI Sentry Network watches every stream for anomalies. It's like having a fraud-detection AI guardian for every payment." },
  { keywords: ["stream", "how", "work"], response: "Streaming payments flow continuously at a rate you set (e.g., 0.0001 QUSDC/sec). When a merchant claims funds, the smart contract pulls from your wallet via transferFrom — you keep full custody of your tokens at all times. No lockups, no escrows." },
  { keywords: ["snake", "game", "arcade"], response: "The Fluenci Snake Arcade is a pay-as-you-play demo! A micro-stream of QUSDC flows while you play. When you stop, the stream terminates and auto-settles to the merchant. It shows how streaming payments work for gaming — no upfront costs." },
  { keywords: ["qie", "blockchain", "chain"], response: "QIE is an EVM-compatible Layer 1 blockchain (Chain ID 1990 for mainnet). It supports QIE Wallet, QIE Pass (decentralized identity), QIEDex (DEX), QIE Domains (.qie names), and QUSDC stablecoin. Fluenci is built natively on all 5 integrations." },
  { keywords: ["nft", "subscription", "token"], response: "Every Fluenci stream is minted as an ERC-721 NFT! This means subscriptions are tradeable — you can transfer, gift, or sell your payment stream on any NFT marketplace. The billing shifts to the new NFT holder automatically." },
  { keywords: ["ai", "sentry", "security", "audit"], response: "The AI Sentry is a multi-agent system: Sentry Agent ingests blockchain events, Analyst Agent uses GPT-4o to audit rates, Decision Agent triggers autonomous safety pauses, and Arbitrator Agent resolves disputes with EIP-712 signatures. All running in real-time." },
  { keywords: ["dispute", "refund"], response: "If you think a merchant is overcharging, open a dispute from the Subscriber Panel. The AI Arbitrator evaluates both sides using GPT-4o, calculates a fair split (e.g., 70% refund, 30% merchant), and signs an EIP-712 message the contract verifies onchain." },
  { keywords: ["qusdc", "stable", "coin", "token"], response: "QUSDC is the official stablecoin on QIE Blockchain, pegged to USD. It's the primary token for Fluenci streams — volatility-free payments mean both subscribers and merchants know exactly what they're paying/earning." },
  { keywords: ["kyc", "pass", "identity", "verify"], response: "Fluenci uses Progressive KYC via QIE Pass. You can receive payments freely, but to withdraw/claim funds, you need QIE Pass verification. This balances frictionless onboarding with compliance requirements." },
  { keywords: ["price", "cost", "fee", "rate"], response: "Fluenci charges a tiny 0.5% protocol fee on claims — 99.5% goes to the merchant, 0.5% to the Fluenci Treasury. Stream rates are set by the subscriber (e.g., 0.0001 QUSDC/sec = 0.36 QUSDC/hr). No hidden fees." },
  { keywords: ["swap", "dex", "exchange", "trade"], response: "Fluenci integrates QIEDex for direct QIE ⇄ QUSDC swaps. You can swap tokens right from the dashboard without leaving the app. The FluenciRouter wraps QIEDex with onchain attribution for tracking swap volume." },
  { keywords: ["domain", ".qie"], response: "QIE Domains let you register human-readable .qie names (like fluenci.qie) that resolve to wallet addresses. Fluenci resolves your domain automatically and displays it in the dashboard — no more copying long hex addresses." },
  { keywords: ["hello", "hi", "hey", "sup"], response: "Hey there! 👋 I'm the Fluenci AI assistant. Ask me anything about streaming payments, the QIE ecosystem, our Snake Arcade, or how the AI Sentry keeps your streams safe. What would you like to know?" },
  { keywords: ["help", "can you", "what can"], response: "I can help with: 🔹 How Fluenci streaming works 🔹 QIE blockchain ecosystem 🔹 AI Sentry security system 🔹 QUSDC stablecoin 🔹 Snake Arcade gaming 🔹 Subscription NFTs 🔹 QIE Pass KYC 🔹 DEX swaps. Just ask!" },
  { keywords: ["hackathon", "competition", "prize"], response: "Fluenci is built for the QIE Blockchain Hackathon 2026! We're competing across DeFi & Payments, AI + Web3, and Gaming categories. The hackathon has a $20K prize pool with prizes distributed as 50% USDT + 50% QIE." },
  { keywords: ["merchant", "claim", "withdraw", "earn"], response: "Merchants receive continuous QUSDC from subscriber streams. To claim, go to the Merchant Dashboard and click 'Claim Funds'. The contract executes a transferFrom pull from the subscriber's wallet. Remember — QIE Pass KYC is required to withdraw." },
  { keywords: ["terminate", "stop", "cancel", "end"], response: "When you terminate a stream, the v2 contract auto-settles any accumulated QUSDC to the merchant before deactivating. This ensures merchants always get paid for time already streamed. No funds are lost on either side." },
  { keywords: ["wallet", "connect", "metamask"], response: "Fluenci works with QIE Wallet (the official QIE browser extension). Connect your wallet, make sure you're on QIE Mainnet (Chain ID 1990), and you're ready to create streams, play games, and swap tokens." },
];

const FALLBACK_RESPONSES = [
  "That's an interesting question! Fluenci is all about making payments stream in real-time. Is there something specific about the protocol I can help with?",
  "Great question! While I'm focused on Fluenci and QIE, I'd love to dive deeper. Try asking about streaming payments, the AI Sentry, or our Snake Arcade!",
  "Hmm, let me think about that... In the meantime, did you know every Fluenci stream is an ERC-721 NFT that can be traded on marketplaces? Pretty cool, right?",
  "I'm best at helping with Fluenci, QIE blockchain, and streaming payments. Try asking 'How do streams work?' or 'What is the AI Sentry?' for detailed answers!",
  "That's beyond my expertise, but here's a fun fact: Fluenci's AI Sentry can autonomously pause a suspicious stream in under 10 seconds using multi-agent GPT-4o analysis!",
];

function getAIResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  // Check keyword matches
  for (const entry of AI_RESPONSES) {
    const matchCount = entry.keywords.filter(k => lower.includes(k)).length;
    if (matchCount >= 1) return entry.response;
  }
  // Fallback
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

export function FluenciAIChat({ subscriberStreams, createSubscription, terminateStream }) {
  const [chatState, setChatState] = useState("locked"); // locked | active | ended
  const [hasActiveStream, setHasActiveStream] = useState(false);
  const [arcadeStream, setArcadeStream] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [msgCount, setMsgCount] = useState(0);

  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // Check stream status
  useEffect(() => {
    const stream = subscriberStreams.find(
      (s) => s.merchant.toLowerCase() === ARCADE_MERCHANT.toLowerCase() && s.active && !s.pausedByAI
    );
    setHasActiveStream(!!stream);
    setArcadeStream(stream || null);
    if (stream && chatState === "locked") {
      setChatState("active");
      if (messages.length === 0) {
        setMessages([{
          role: "ai",
          text: "Welcome to Fluenci AI! 🤖 Your QUSDC stream is active. Ask me anything about Fluenci, QIE blockchain, streaming payments, or our ecosystem. You're paying 0.0001 QUSDC/sec while we chat.",
          time: new Date()
        }]);
      }
    }
    if (!stream && chatState !== "locked") setChatState("locked");
  }, [subscriberStreams]);

  // Session timer
  useEffect(() => {
    if (chatState === "active") {
      timerRef.current = setInterval(() => setSessionTime(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [chatState]);

  // Auto-scroll
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const handleStartStream = async () => {
    try {
      await createSubscription(ARCADE_MERCHANT, "QUSDC", "100", 0, 0);
    } catch (err) {
      console.error("Failed to start AI Chat stream", err);
    }
  };

  const handleEndSession = async () => {
    if (!arcadeStream) return;
    try {
      await terminateStream(arcadeStream.id);
      setChatState("ended");
    } catch (err) {
      console.error("Failed to end session", err);
    }
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isTyping || chatState !== "active") return;

    const userMsg = { role: "user", text, time: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setMsgCount(c => c + 1);
    setInputValue("");
    setIsTyping(true);

    try {
      // Build conversation history for the API
      const history = [...messages, userMsg]
        .filter(m => m.role === "user" || m.role === "ai")
        .map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      const res = await fetch("http://localhost:5001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });

      if (!res.ok) throw new Error("API unavailable");

      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.reply, time: new Date() }]);
    } catch (err) {
      // Fallback to local keyword engine if server is down
      console.warn("AI Chat API unavailable, using local fallback:", err.message);
      const response = getAIResponse(text);
      setMessages(prev => [...prev, { role: "ai", text: response, time: new Date() }]);
    }
    setIsTyping(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const qusdcStreamed = (sessionTime * 0.0001).toFixed(4);
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
      {/* Chat Area */}
      <div style={{
        flex: "1 1 340px",
        display: "flex",
        flexDirection: "column",
        background: chatState === "active" ? "#ffffff" : "#0a0e1a",
        borderRadius: "16px",
        minHeight: "424px",
        maxHeight: "424px",
        border: "1px solid #e0e0e0",
        overflow: "hidden"
      }}>
        {chatState === "active" ? (
          <>
            {/* Messages */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px"
            }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: "8px",
                  alignItems: "flex-end"
                }}>
                  {msg.role === "ai" && (
                    <div style={{
                      width: "28px", height: "28px", borderRadius: "50%",
                      background: "#111", color: "#fff", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      fontSize: "0.65rem", fontWeight: "bold", flexShrink: 0
                    }}>AI</div>
                  )}
                  <div style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: msg.role === "user" ? "#111111" : "#f0f0f0",
                    color: msg.role === "user" ? "#ffffff" : "#111111",
                    fontSize: "0.85rem",
                    lineHeight: "1.45"
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: "#111", color: "#fff", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: "0.65rem", fontWeight: "bold", flexShrink: 0
                  }}>AI</div>
                  <div style={{
                    padding: "10px 18px", borderRadius: "16px 16px 16px 4px",
                    background: "#f0f0f0", display: "flex", gap: "4px", alignItems: "center"
                  }}>
                    <span style={{ animation: "typingDot 1.2s infinite 0s" }} className="typing-dot" />
                    <span style={{ animation: "typingDot 1.2s infinite 0.2s" }} className="typing-dot" />
                    <span style={{ animation: "typingDot 1.2s infinite 0.4s" }} className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: "12px 16px",
              borderTop: "1px solid #e8e8e8",
              display: "flex",
              gap: "8px",
              background: "#fafafa"
            }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask about Fluenci, QIE, streaming payments..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid #e0e0e0",
                  background: "#ffffff",
                  color: "#111",
                  fontSize: "0.85rem",
                  outline: "none"
                }}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isTyping}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  background: inputValue.trim() && !isTyping ? "#111" : "#d4d4d4",
                  color: "#fff",
                  border: "none",
                  cursor: inputValue.trim() && !isTyping ? "pointer" : "default",
                  fontSize: "0.85rem",
                  fontWeight: "bold",
                  transition: "background 0.2s"
                }}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", padding: "20px", textAlign: "center"
          }}>
            <div style={{ fontSize: "3.5rem", marginBottom: "12px" }}>🤖</div>
            {hasActiveStream ? (
              <>
                <p style={{ color: "#aaa", fontWeight: "bold", margin: "0 0 16px 0", fontSize: "1.1rem" }}>
                  Stream Active!
                </p>
                <button
                  onClick={() => setChatState("active")}
                  className="btn btn-primary"
                  style={{ padding: "10px 24px", justifyContent: "center" }}
                >
                  Open Chat
                </button>
              </>
            ) : chatState === "ended" ? (
              <>
                <p style={{ color: "#aaa", fontWeight: "bold", margin: "0 0 6px 0", fontSize: "1.1rem" }}>
                  Session Ended
                </p>
                <p style={{ color: "#888", fontSize: "0.85rem", margin: "0 0 6px 0" }}>
                  {msgCount} messages · {fmtTime(sessionTime)} · {qusdcStreamed} QUSDC
                </p>
                <button
                  onClick={() => {
                    setMessages([]);
                    setSessionTime(0);
                    setMsgCount(0);
                    setChatState("locked");
                  }}
                  className="btn btn-primary"
                  style={{ padding: "10px 24px", justifyContent: "center", marginTop: "12px" }}
                >
                  New Session
                </button>
              </>
            ) : (
              <>
                <p style={{ color: "#888", maxWidth: "260px", margin: "0 auto 20px auto", fontSize: "0.85rem" }}>
                  Start a micro-payment stream to chat with Fluenci AI. Pay only for the time you use.
                </p>
                <button
                  onClick={handleStartStream}
                  className="btn btn-primary"
                  style={{ padding: "10px 24px", justifyContent: "center" }}
                >
                  Start AI Session
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Telemetry Sidebar */}
      <div style={{ flex: "0 0 240px", minWidth: "240px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="glass-card" style={{ background: "#f8f8f8", border: "1px solid #e8e8e8", padding: "16px" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#111111" }}>Chat Telemetry</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
            <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Messages</div>
              <div style={{ fontSize: "1.3rem", color: "#111", fontWeight: "bold" }}>{msgCount}</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Session</div>
              <div style={{ fontSize: "1.1rem", color: "#111", fontWeight: "bold", fontFamily: "monospace" }}>{fmtTime(sessionTime)}</div>
            </div>
            <div style={{ gridColumn: "span 2", background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Streamed</div>
              <div style={{ fontSize: "0.95rem", color: "#111", fontWeight: "bold" }}>{qusdcStreamed} <span style={{ fontSize: "0.7rem", color: "#888" }}>QUSDC</span></div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <div style={{
              width: "8px", height: "8px", borderRadius: "50%",
              background: chatState === "active" ? "#16a34a" : chatState === "ended" ? "#cc3333" : "#d4d4d4",
              boxShadow: chatState === "active" ? "0 0 6px #16a34a" : "none"
            }} />
            <span style={{ fontSize: "0.8rem", color: "#666", fontWeight: "600" }}>
              {chatState === "active" ? "ACTIVE" : chatState === "ended" ? "ENDED" : "IDLE"}
            </span>
          </div>

          {chatState === "active" && (
            <button
              onClick={handleEndSession}
              style={{
                width: "100%", padding: "8px", borderRadius: "8px",
                background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)",
                color: "#ff6b6b", fontSize: "0.8rem", fontWeight: "bold",
                cursor: "pointer", transition: "all 0.2s"
              }}
            >
              End Session
            </button>
          )}

          <div style={{
            background: "rgba(0,0,0,0.03)", padding: "10px 12px", borderRadius: "8px",
            display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem",
            marginTop: "12px"
          }}>
            <span style={{ color: "#888" }}>Stream Rate</span>
            <span style={{ color: "#111", fontWeight: "bold" }}>0.0001 QUSDC/sec</span>
          </div>
        </div>

        <div style={{ fontSize: "0.8rem", color: "#888", lineHeight: "1.5", padding: "0 4px" }}>
          💡 <strong style={{ color: "#555" }}>How it works:</strong> Chat with Fluenci AI while a micro-stream flows at 0.0001 QUSDC/sec. End your session anytime — accumulated QUSDC auto-settles to the merchant. Pay only for what you use.
        </div>
      </div>
    </div>
  );
}
