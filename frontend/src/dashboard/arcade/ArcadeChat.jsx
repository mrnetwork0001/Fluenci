import { useEffect, useRef, useState } from "react";

// Mirrors the server's /api/chat limits so a request is never rejected (or
// silently truncated) for something the client could have caught first.
const STORAGE_KEY = "fluenci_arcade_chat_v2";
const MAX_CHARS = 1000;
const MAX_HISTORY = 12;
const MAX_TOTAL_CHARS = 6000;  // server drops older turns past this; do it here so the model sees the same window
const COUNTER_FROM = 800;      // only show the counter once it is relevant
const MAX_STORED = 100;        // keeps localStorage bounded on long chats
const REQUEST_TIMEOUT_MS = 30000;

const NOTICE_FAILED = "The AI is unavailable right now - try again in a moment.";
// Keyed by the `code` /api/chat sends with every error. The per-IP limit is
// shared by everyone on one connection, so it doesn't say "you're too fast".
const NOTICE_BY_CODE = {
  rate_ip: "Too many chat messages have come from your network recently. Wait a few minutes and try again.",
  rate_daily: "The AI chat has reached its limit for today. It resets at midnight UTC.",
  disabled: "The AI chat is switched off for now. Try again later.",
  too_large: "This conversation is too long to send. Clear the chat and try again.",
  bad_request: "That message couldn't be sent. Clear the chat and try again.",
  not_configured: "The AI chat isn't set up on the server yet.",
  upstream: NOTICE_FAILED,
};
const NOTICE_RATE = "The AI chat is busy right now. Wait a few minutes and try again.";

// Only real turns are persisted; a stale "unavailable" notice on reload would
// be misleading.
function loadMessages() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
  } catch {
    return [];
  }
}

function saveMessages(messages) {
  try {
    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (turns.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_STORED)));
  } catch {
    /* private mode / quota - chat still works, it just won't survive a reload */
  }
}

// What actually goes over the wire: no system notices, each turn capped, and
// only the recent window the server will look at.
function toPayload(messages) {
  const recent = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_HISTORY);
  // Drop the oldest turns until the total fits, always keeping the newest.
  let total = recent.reduce((sum, m) => sum + m.content.length, 0);
  while (total > MAX_TOTAL_CHARS && recent.length > 1) total -= recent.shift().content.length;
  return recent;
}

/**
 * Arcade AI chat for the v2 dashboard. Access (QIE Pass + subscription) is
 * decided by the parent; this component only talks to /api/chat and never
 * invents an answer when that call fails.
 */
export default function ArcadeChat({ apiBase = null, disabled = false }) {
  const [messages, setMessages] = useState(() => loadMessages());
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  // Bumped on clear/unmount so a reply that lands afterwards is dropped
  // instead of reappearing in an emptied chat.
  const genRef = useRef(0);

  const noBackend = !apiBase;
  const locked = disabled || noBackend;
  const text = input.trim();
  const canSend = !locked && !pending && text.length > 0;

  useEffect(() => saveMessages(messages), [messages]);

  // Scroll the message pane itself; scrollIntoView would also drag the
  // dashboard's .fl-main scroller along with it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => () => {
    genRef.current += 1;
    abortRef.current?.abort();
  }, []);

  // Grow the textarea with its content up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const send = async () => {
    if (!canSend) return;
    const userMsg = { role: "user", content: text.slice(0, MAX_CHARS), ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setPending(true);

    const gen = genRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let reply = null;
    let notice = null;
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toPayload(next) }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // A 429 without a code (an older server) still says which limit it was.
        const serverText = typeof body?.error === "string" && body.error.length < 160 ? body.error : null;
        notice = NOTICE_BY_CODE[body?.code] || (res.status === 429 ? serverText || NOTICE_RATE : NOTICE_FAILED);
      } else {
        const data = await res.json().catch(() => null);
        if (typeof data?.reply === "string" && data.reply.trim()) reply = data.reply;
        else notice = NOTICE_FAILED;
      }
    } catch {
      notice = NOTICE_FAILED;
    } finally {
      clearTimeout(timer);
    }

    if (gen !== genRef.current) return; // cleared or unmounted meanwhile
    abortRef.current = null;
    setMessages((prev) => [
      ...prev,
      reply
        ? { role: "assistant", content: reply, ts: Date.now() }
        : { role: "system", content: notice, ts: Date.now() },
    ]);
    setPending(false);
  };

  const clear = () => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setMessages([]);
  };

  const onKeyDown = (e) => {
    // isComposing: don't send half-typed IME input (CJK keyboards use Enter to commit).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const remaining = MAX_CHARS - input.length;

  return (
    <div className="fl-card" style={styles.card}>
      <style>{KEYFRAMES}</style>

      {/* header */}
      <div className="fl-row--between" style={styles.header}>
        <div className="fl-row" style={{ gap: 8, minWidth: 0 }}>
          <span className="fl-lbl">AI chat</span>
          <span className={`fl-pill ${locked ? "fl-pill--off" : "fl-pill--on"}`}>
            {noBackend ? "Offline" : disabled ? "Locked" : "Live"}
          </span>
        </div>
        <button className="fl-link" onClick={clear}
                disabled={messages.length === 0 && !pending}
                style={{ fontSize: 12, opacity: messages.length === 0 && !pending ? 0.4 : 1 }}>
          Clear chat
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={styles.scroll} aria-live="polite">
        {noBackend && (
          <div className="fl-inner" style={styles.notice}>
            Chat needs the Fluenci backend. Set <span className="fl-mono">VITE_API_URL</span> to
            the API origin and reload.
          </div>
        )}

        {messages.length === 0 && !noBackend && (
          <div style={styles.empty}>
            Ask about Fluenci, QIE, subscriptions or the Arcade. Replies come from the
            live AI - nothing here is scripted.
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "system" ? (
            <div key={`${m.ts}-${i}`} style={styles.system}>{m.content}</div>
          ) : (
            <div key={`${m.ts}-${i}`}
                 style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={m.role === "user" ? styles.userBubble : styles.aiBubble}>{m.content}</div>
            </div>
          )
        )}

        {pending && (
          <div style={{ display: "flex" }} aria-label="AI is typing">
            <div style={{ ...styles.aiBubble, display: "flex", gap: 5, alignItems: "center", padding: "13px 16px" }}>
              {[0, 0.2, 0.4].map((d) => (
                <span key={d} className="fl-arcade-dot" style={{ ...styles.dot, animationDelay: `${d}s` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <div style={styles.footer}>
        <div className="fl-inner" style={styles.inputWrap}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_CHARS}
            disabled={locked}
            placeholder={locked ? (noBackend ? "Chat is offline" : "Chat is locked") : "Message the Arcade AI…"}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            style={styles.textarea}
          />
          <button className="fl-btn fl-btn--primary" style={{ padding: "9px 14px", flexShrink: 0 }}
                  disabled={!canSend} onClick={send}>
            Send
          </button>
        </div>
        <div className="fl-row--between" style={{ marginTop: 6, minHeight: 15 }}>
          <span style={{ color: "var(--fl-fg-3)", fontSize: 11 }}>Enter to send · Shift+Enter for a new line</span>
          {input.length >= COUNTER_FROM && (
            <span className="fl-mono"
                  style={{ fontSize: 11, color: remaining <= 50 ? "var(--fl-warn)" : "var(--fl-fg-3)" }}>
              {input.length}/{MAX_CHARS}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Namespaced so it can't collide with the v1 typingDot keyframes in App.css.
const KEYFRAMES = `
@keyframes flArcadeDot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .fl-arcade-dot { animation: none !important; } }
`;

const bubble = {
  maxWidth: "82%", padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5,
  whiteSpace: "pre-wrap", overflowWrap: "anywhere",
};

const styles = {
  card: {
    padding: 0, display: "flex", flexDirection: "column", overflow: "hidden",
    height: "min(420px, 75dvh)", minHeight: 320,
  },
  header: { padding: "12px 16px", borderBottom: "1px solid var(--fl-border)", flexShrink: 0 },
  scroll: {
    flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
    padding: 16, display: "flex", flexDirection: "column", gap: 10,
  },
  footer: { padding: "12px 16px", borderTop: "1px solid var(--fl-border)", flexShrink: 0 },
  inputWrap: { display: "flex", alignItems: "flex-end", gap: 8, padding: 6, paddingLeft: 12 },
  textarea: {
    flex: 1, minWidth: 0, resize: "none", background: "none", border: "none", outline: "none",
    color: "var(--fl-fg)", fontFamily: "inherit", fontSize: 14, lineHeight: 1.45, padding: "7px 0",
    maxHeight: 120,
  },
  userBubble: {
    ...bubble, background: "var(--fl-accent-soft)", color: "var(--fl-fg)",
    border: "1px solid rgba(7, 154, 183, .25)", borderRadius: "14px 14px 4px 14px",
  },
  aiBubble: {
    ...bubble, background: "var(--fl-raised)", color: "var(--fl-fg)",
    border: "1px solid var(--fl-border)", borderRadius: "14px 14px 14px 4px",
  },
  system: {
    alignSelf: "center", maxWidth: "90%", textAlign: "center", color: "var(--fl-warn)",
    fontSize: 12, lineHeight: 1.5, padding: "4px 8px",
  },
  notice: { padding: "12px 14px", color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.55 },
  empty: {
    margin: "auto", maxWidth: 300, textAlign: "center", color: "var(--fl-fg-3)",
    fontSize: 12.5, lineHeight: 1.6,
  },
  dot: {
    width: 6, height: 6, borderRadius: "50%", background: "var(--fl-fg-2)", display: "inline-block",
    animation: "flArcadeDot 1.2s infinite ease-in-out",
  },
};
