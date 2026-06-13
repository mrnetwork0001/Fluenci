import React, { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../config";

const ARCADE_MERCHANT = "0xfe5f1d13a31a5b86833adf4486720331d6e4a6bb";
const STORAGE_KEY = "fluenci_chat_sessions";

// Local fallback responses
const AI_RESPONSES = [
  { keywords: ["fluenci", "what is", "about"], response: "Fluenci is a decentralized real-time streaming payment protocol on QIE Blockchain. Instead of monthly charges, you pay per second - and an AI Sentry Network watches every stream for anomalies." },
  { keywords: ["stream", "how", "work"], response: "Streaming payments flow continuously at a rate you set (e.g., 0.0001 QUSDC/sec). The smart contract pulls from your wallet via transferFrom - you keep full custody at all times." },
  { keywords: ["qie", "blockchain", "chain"], response: "QIE is an EVM-compatible L1 blockchain (Chain ID 1990). It supports QIE Wallet, QIE Pass, QIEDex, QIE Domains, and QUSDC stablecoin." },
  { keywords: ["ai", "sentry", "security"], response: "The AI Sentry uses multi-agent GPT-4o analysis to detect and pause suspicious streams autonomously via EIP-712 signatures." },
  { keywords: ["hello", "hi", "hey"], response: "Hey! 👋 I'm the Fluenci AI assistant powered by GPT-4o. Ask me anything about streaming payments, QIE, or DeFi!" },
  { keywords: ["help", "can you"], response: "I can help with Fluenci streaming, QIE ecosystem, AI Sentry security, QUSDC stablecoin, NFT subscriptions, and more. Just ask!" },
];
const FALLBACKS = [
  "Interesting question! I'm best at Fluenci, QIE, and streaming payments. Ask me about those for detailed answers!",
  "Let me think... Did you know every Fluenci stream is an ERC-721 NFT that can be traded on marketplaces?",
];
function getAIResponse(msg) {
  const l = msg.toLowerCase();
  for (const e of AI_RESPONSES) if (e.keywords.some(k => l.includes(k))) return e.response;
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
}

// Load/save sessions from localStorage
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveSessions(sessions) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}

export function FluenciAIChat({ subscriberStreams, createSubscription, terminateStream }) {
  const [chatState, setChatState] = useState("locked");
  const [hasActiveStream, setHasActiveStream] = useState(false);
  const [arcadeStream, setArcadeStream] = useState(null);

  // Session history
  const [sessions, setSessions] = useState(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [msgCount, setMsgCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const chatEndRef = useRef(null);
  const timerRef = useRef(null);

  // Check stream status
  useEffect(() => {
    const stream = subscriberStreams.find(
      (s) => s.merchant.toLowerCase() === ARCADE_MERCHANT.toLowerCase() && s.active && !s.pausedByAI
    );
    setHasActiveStream(!!stream);
    setArcadeStream(stream || null);
    if (stream && chatState === "locked") {
      setChatState("active");
      // Start a new session if none active
      if (!activeSessionId) startNewSession();
    }
    if (!stream && chatState !== "locked" && chatState !== "ended") setChatState("locked");
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
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Save current session to localStorage whenever messages change
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const updated = sessions.map(s =>
      s.id === activeSessionId
        ? { ...s, messages, msgCount, sessionTime, updatedAt: new Date().toISOString() }
        : s
    );
    setSessions(updated);
    saveSessions(updated);
  }, [messages, msgCount]);

  function startNewSession() {
    const id = Date.now().toString();
    const welcomeMsg = {
      role: "ai",
      text: "Welcome to Fluenci AI! 🤖 Your QUSDC stream is active. Ask me anything about Fluenci, QIE blockchain, streaming payments, or our ecosystem.",
      time: new Date().toISOString()
    };
    const newSession = {
      id,
      title: "New Chat",
      messages: [welcomeMsg],
      msgCount: 0,
      sessionTime: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    setActiveSessionId(id);
    setMessages([welcomeMsg]);
    setMsgCount(0);
    setSessionTime(0);
  }

  function loadSession(session) {
    setActiveSessionId(session.id);
    setMessages(session.messages || []);
    setMsgCount(session.msgCount || 0);
    setSessionTime(session.sessionTime || 0);
    setShowHistory(false);
  }

  function deleteSession(id, e) {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    saveSessions(updated);
    if (activeSessionId === id) {
      if (updated.length > 0) {
        loadSession(updated[0]);
      } else {
        setActiveSessionId(null);
        setMessages([]);
        setMsgCount(0);
        setSessionTime(0);
      }
    }
  }

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

    const userMsg = { role: "user", text, time: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setMsgCount(c => c + 1);
    setInputValue("");
    setIsTyping(true);

    // Update session title from first user message
    if (msgCount === 0 && activeSessionId) {
      const title = text.length > 30 ? text.slice(0, 30) + "..." : text;
      const updated = sessions.map(s => s.id === activeSessionId ? { ...s, title } : s);
      setSessions(updated);
      saveSessions(updated);
    }

    try {
      const history = newMessages
        .filter(m => m.role === "user" || m.role === "ai")
        .map(m => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });
      if (!res.ok) throw new Error("API unavailable");
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.reply, time: new Date().toISOString() }]);
    } catch (err) {
      console.warn("AI Chat API unavailable, using local fallback:", err.message);
      const response = getAIResponse(text);
      setMessages(prev => [...prev, { role: "ai", text: response, time: new Date().toISOString() }]);
    }
    setIsTyping(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const qusdcStreamed = (sessionTime * 0.0001).toFixed(4);
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Fullscreen wrapper
  const chatContent = (
    <div style={{
      display: "flex", gap: isFullscreen ? "0" : "24px", flexWrap: isFullscreen ? "nowrap" : "wrap",
      ...(isFullscreen ? {
        position: "fixed", inset: 0, zIndex: 9999, background: "#fff",
        padding: "0", flexDirection: "row"
      } : {})
    }}>
      {/* Chat Area */}
      <div style={{
        flex: isFullscreen ? "1" : "1 1 340px",
        display: "flex",
        flexDirection: "column",
        background: chatState === "active" ? "#ffffff" : "#0a0e1a",
        borderRadius: isFullscreen ? "0" : "16px",
        minHeight: isFullscreen ? "100vh" : "424px",
        maxHeight: isFullscreen ? "100vh" : "424px",
        border: isFullscreen ? "none" : "1px solid #e0e0e0",
        overflow: "hidden",
        position: "relative"
      }}>
        {chatState === "active" ? (
          <>
            {/* Chat Header with History Toggle */}
            <div style={{
              padding: "10px 16px",
              borderBottom: "1px solid #e8e8e8",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#fafafa"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "1.1rem", padding: "2px 4px", borderRadius: "4px",
                    color: "#666", transition: "color 0.2s"
                  }}
                  title="Chat History"
                >☰</button>
                <span style={{ fontSize: "0.8rem", color: "#888", fontWeight: "600" }}>
                  {activeSession?.title || "New Chat"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <button
                  onClick={() => { if (chatState === "active") startNewSession(); }}
                  style={{
                    background: "#111", color: "#fff", border: "none",
                    padding: "4px 12px", borderRadius: "6px", fontSize: "0.72rem",
                    fontWeight: "bold", cursor: "pointer", transition: "opacity 0.2s"
                  }}
                >+ New Chat</button>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  style={{
                    background: "none", border: "1px solid #e0e0e0", cursor: "pointer",
                    fontSize: "0.85rem", padding: "3px 8px", borderRadius: "6px",
                    color: "#666", transition: "all 0.2s"
                  }}
                  title={isFullscreen ? "Exit Fullscreen" : "Expand"}
                >{isFullscreen ? "✕" : "⛶"}</button>
              </div>
            </div>

            {/* History Sidebar Overlay */}
            {showHistory && (
              <div style={{
                position: "absolute", top: "42px", left: 0, bottom: 0, width: "220px",
                background: "#f5f5f5", borderRight: "1px solid #e0e0e0",
                zIndex: 10, overflowY: "auto", padding: "8px"
              }}>
                <div style={{ fontSize: "0.7rem", color: "#999", fontWeight: "bold", textTransform: "uppercase", padding: "4px 8px", letterSpacing: "0.05em" }}>
                  Chat History ({sessions.length})
                </div>
                {sessions.length === 0 && (
                  <div style={{ padding: "16px 8px", color: "#aaa", fontSize: "0.8rem", textAlign: "center" }}>No sessions yet</div>
                )}
                {sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => loadSession(s)}
                    style={{
                      padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                      background: s.id === activeSessionId ? "#e8e8e8" : "transparent",
                      marginBottom: "2px", transition: "background 0.15s",
                      display: "flex", justifyContent: "space-between", alignItems: "center"
                    }}
                  >
                    <div style={{ overflow: "hidden" }}>
                      <div style={{
                        fontSize: "0.78rem", color: "#333", fontWeight: s.id === activeSessionId ? "bold" : "500",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px"
                      }}>{s.title}</div>
                      <div style={{ fontSize: "0.65rem", color: "#aaa" }}>
                        {s.msgCount || 0} msgs · {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      style={{
                        background: "none", border: "none", color: "#ccc", cursor: "pointer",
                        fontSize: "0.9rem", padding: "0 2px", flexShrink: 0
                      }}
                      title="Delete"
                    >�-</button>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "16px",
              display: "flex", flexDirection: "column", gap: "10px"
            }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: "8px", alignItems: "flex-end"
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
                    maxWidth: "75%", padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: msg.role === "user" ? "#111111" : "#f0f0f0",
                    color: msg.role === "user" ? "#ffffff" : "#111111",
                    fontSize: "0.85rem", lineHeight: "1.45"
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
              padding: "12px 16px", borderTop: "1px solid #e8e8e8",
              display: "flex", gap: "8px", background: "#fafafa"
            }}>
              <input
                type="text"
                placeholder="Ask about Fluenci, QIE, streaming payments..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #e0e0e0", background: "#ffffff",
                  color: "#111", fontSize: "0.85rem", outline: "none"
                }}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isTyping}
                style={{
                  padding: "10px 16px", borderRadius: "10px",
                  background: inputValue.trim() && !isTyping ? "#111" : "#d4d4d4",
                  color: "#fff", border: "none",
                  cursor: inputValue.trim() && !isTyping ? "pointer" : "default",
                  fontSize: "0.85rem", fontWeight: "bold", transition: "background 0.2s"
                }}
              >Send</button>
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
                  onClick={() => { setChatState("active"); if (!activeSessionId) startNewSession(); }}
                  className="btn btn-primary"
                  style={{ padding: "10px 24px", justifyContent: "center" }}
                >Open Chat</button>
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
                  onClick={() => { setSessionTime(0); setMsgCount(0); setChatState("locked"); }}
                  className="btn btn-primary"
                  style={{ padding: "10px 24px", justifyContent: "center", marginTop: "12px" }}
                >New Session</button>
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
                >Start AI Session</button>
                {sessions.length > 0 && (
                  <p style={{ color: "#666", fontSize: "0.75rem", marginTop: "12px" }}>
                    {sessions.length} past session{sessions.length > 1 ? "s" : ""} saved
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Telemetry Sidebar - hidden in fullscreen */}
      {!isFullscreen && (
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
            >End Session</button>
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
          💡 <strong style={{ color: "#555" }}>Powered by GPT-4o.</strong> Chat with real AI while a micro-stream flows at 0.0001 QUSDC/sec. Your chat history is saved locally - pick up where you left off.
        </div>
      </div>
      )}
    </div>
  );

  return chatContent;
}
