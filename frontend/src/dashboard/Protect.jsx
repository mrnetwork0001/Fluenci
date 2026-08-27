import React, { useMemo, useState } from "react";
import { StatCard, EmptyState } from "./DashboardShell";
import { IconPulse, IconShield, IconCheck } from "./icons";

const TONE = {
  INFO:     { label: "Info",   cls: "fl-pill--off" },
  SUCCESS:  { label: "OK",     cls: "fl-pill--on" },
  WARNING:  { label: "Warn",   cls: "fl-pill--warn" },
  ALERT:    { label: "Alert",  cls: "fl-pill--warn" },
  SYSTEM:   { label: "System", cls: "fl-pill--off" },
};

const riskTone = (n) => (n >= 75 ? "warn" : n >= 40 ? undefined : "accent");

/**
 * Fluenci Protect - one surface replacing the four-agent AI dashboard.
 *
 * The v1 Security Desk exposed Sentry / Analyst / Decision / Arbitrator as
 * separate panels, which read as demo scaffolding rather than a product. This
 * presents a single system: what it is watching, what it found, and the one
 * control that matters - the risk level at which it pauses a stream.
 */
export default function Protect({
  loading = false,
  online = false,
  systemRisk = 0,
  watchedStreams = 0,
  pausedByAI = 0,
  events = [],
  threshold = 75,
  savingThreshold = false,
  canConfigure = false,
  onSaveThreshold = null,
  onResume = null,
  onViewStream = null,
}) {
  const [draft, setDraft] = useState(threshold);
  const dirty = Number(draft) !== Number(threshold);

  // A wallet is necessary but not sufficient: without onSaveThreshold there is
  // nowhere to put the value, and the control shipped enabled - so dragging the
  // slider and pressing Save dropped the change with no error and no feedback.
  const hasSaver = typeof onSaveThreshold === "function";
  const canSave = canConfigure && hasSaver;

  const rows = useMemo(
    () => (Array.isArray(events) ? events.filter((e) => e && typeof e === "object") : []),
    [events]
  );

  return (
    <>
      <h1 className="fl-title">Fluenci Protect</h1>
      <p className="fl-sub">
        Watches every stream you fund or receive, and pauses one automatically if its billing
        behaviour changes in a way it cannot explain.
      </p>

      <div className="fl-grid-4" style={{ marginBottom: 34 }}>
        <StatCard
          label="Status"
          value={online ? "Active" : "Offline"}
          note={online ? "monitoring in real time" : "the monitoring node is unreachable"}
          tone={online ? "accent" : "warn"}
        />
        <StatCard label="Streams watched" value={watchedStreams} note="yours, in both directions" />
        <StatCard
          label="System risk"
          value={`${systemRisk}%`}
          note={systemRisk >= threshold ? "above your pause threshold" : "within normal range"}
          tone={riskTone(systemRisk)}
        />
        <StatCard
          label="Paused by Protect"
          value={pausedByAI}
          note={pausedByAI > 0 ? "awaiting your review" : "nothing held"}
          tone={pausedByAI > 0 ? "warn" : undefined}
        />
      </div>

      <div className="fl-split fl-split--protect">
        <div>
          <h2 className="fl-h2">Recent activity</h2>
          {loading ? (
            <div className="fl-card"><div className="fl-lbl">Loading…</div></div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<IconPulse size={26} stroke="#333333" />}
              title={online ? "Nothing to report" : "Protect is offline"}
              body={
                online
                  ? "Protect is watching your streams. Anything unusual - a rate change, an unexpected claim, a merchant losing verification - shows up here."
                  : "The monitoring node is not reachable, so nothing is being watched right now. Your streams are unaffected and keep settling normally."
              }
            />
          ) : (
            <div className="fl-card fl-card--flush">
              <div className="fl-thead" style={{ gridTemplateColumns: "0.6fr 2.4fr 1fr" }}>
                <div className="fl-lbl">Type</div>
                <div className="fl-lbl">Event</div>
                <div className="fl-lbl">When</div>
              </div>
              {rows.map((e, i) => {
                const tone = TONE[String(e.type || "").toUpperCase()] || TONE.INFO;
                return (
                  <div key={`ev-${i}-${e.id ?? ""}`} className="fl-trow"
                       style={{ gridTemplateColumns: "0.6fr 2.4fr 1fr",
                                cursor: e.subId && onViewStream ? "pointer" : "default" }}
                       onClick={() => e.subId && onViewStream?.(e.subId)}>
                    <div><span className={`fl-pill ${tone.cls}`}>{tone.label}</span></div>
                    <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.5 }}>{e.message}</div>
                    <div className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11.5 }}>
                      {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pausedByAI > 0 && (
            <div className="fl-inner" style={{ padding: "14px 16px", marginTop: 16, borderColor: "var(--fl-warn)" }}>
              <div className="fl-row--between">
                <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.55 }}>
                  {pausedByAI === 1 ? "One stream is" : `${pausedByAI} streams are`} paused. No funds move while
                  a stream is held, and time spent paused is never billed.
                </div>
                {onResume && (
                  <button className="fl-btn fl-btn--ghost" onClick={onResume} style={{ flexShrink: 0 }}>
                    Review
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="fl-card">
          <div className="fl-lbl" style={{ marginBottom: 7 }}>Pause threshold</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 18 }}>
            Protect pauses a stream when its risk reaches this level. Lower is more cautious and
            will hold streams more often.
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 14 }}>
            <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 32, fontWeight: 600 }}>{draft}</span>
            <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 14 }}>%</span>
          </div>

          <input
            type="range" min="10" max="95" step="5" value={draft}
            disabled={!canSave || savingThreshold}
            onChange={(e) => setDraft(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--fl-accent)", marginBottom: 8 }}
          />
          <div className="fl-row--between" style={{ marginBottom: 18 }}>
            <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11 }}>10 - cautious</span>
            <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11 }}>95 - permissive</span>
          </div>

          <button
            className="fl-btn fl-btn--primary fl-btn--block"
            disabled={!canSave || !dirty || savingThreshold}
            onClick={() => onSaveThreshold?.(Number(draft))}
          >
            {savingThreshold ? "Saving…" : dirty ? "Save threshold" : "Saved"}
          </button>

          {!canSave && (
            <div style={{ color: "var(--fl-fg-3)", fontSize: 11.5, lineHeight: 1.55, marginTop: 12 }}>
              {hasSaver
                ? "Connect the wallet that owns these streams to change the threshold."
                : "Protect is running on its default threshold. Changing it is not available yet."}
            </div>
          )}

          <div className="fl-inner" style={{ display: "flex", gap: 11, padding: "14px 16px", marginTop: 18 }}>
            <IconShield size={15} stroke="var(--fl-accent)" />
            <div style={{ color: "var(--fl-fg-3)", fontSize: 11.5, lineHeight: 1.6 }}>
              Protect never holds your funds - a subscription locks nothing up. It can pause a
              stream, and only you can cancel one or raise a spending limit. The single case where
              its key moves money is settling a dispute you opened: capped at what has already
              accrued, clamped by your spending limit, and payable only to that merchant.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
