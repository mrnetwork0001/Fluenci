import { sameAddress, shortAddress, weekLabel } from "./arcadeApi";

const muted = { color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6 };
const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

/**
 * This week's Snake top 20 (from useLeaderboard). Scores reach it only through
 * the server's replay check; the panel just shows them. No prizes.
 */
export default function Leaderboard({
  status = "loading", week = "", entries = [], you = null, youKnown = false, names = {},
  account = null, signedIn = false, passValid = false, onRetry = null,
}) {
  let youLine;
  if (signedIn) {
    youLine = you
      ? <>You're <strong style={{ color: "var(--fl-fg)" }}>#{you.rank}</strong> this week with <span className="fl-mono" style={{ color: "var(--fl-fg)" }}>{you.best}</span>.</>
      : (youKnown ? "You're not on this week's board yet." : null);
  } else if (passValid) {
    youLine = "Sign in to the Arcade to put your scores on the board.";
  } else {
    youLine = "Only Arcade Pass holders who sign in can post scores.";
  }

  return (
    <div className="fl-card" style={{ marginTop: 16 }}>
      <div className="fl-row--between" style={{ marginBottom: 12 }}>
        <div className="fl-lbl">Snake leaderboard</div>
        {week && <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11.5 }}>{weekLabel(week)}</span>}
      </div>

      {status === "loading" && <div style={muted}>Loading this week's scores…</div>}

      {status === "failed" && (
        <div style={muted}>
          The leaderboard isn't available right now.{" "}
          {onRetry && <button className="fl-link" style={{ fontSize: 12.5, padding: 0 }} onClick={onRetry}>Try again</button>}
        </div>
      )}

      {status === "ready" && entries.length === 0 && <div style={muted}>No scores yet this week.</div>}

      {status === "ready" && entries.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
          {entries.map((e, i) => {
            const mine = sameAddress(e.address, account);
            const name = names[e.address.toLowerCase()];
            return (
              <li key={e.address} className="fl-row--between"
                  style={{ padding: "7px 10px", borderRadius: 8, background: mine ? "var(--fl-accent-soft)" : "transparent" }}>
                <span className="fl-row" style={{ gap: 10, minWidth: 0 }}>
                  <span className="fl-mono" style={{ width: 20, flexShrink: 0, color: "var(--fl-fg-3)", fontSize: 12 }}>{i + 1}</span>
                  <span className={name ? "" : "fl-mono"} title={e.address}
                        style={{ ...ellipsis, color: "var(--fl-fg)", fontSize: 13 }}>
                    {name || shortAddress(e.address)}{mine ? " (you)" : ""}
                  </span>
                </span>
                <span className="fl-mono" style={{ color: "var(--fl-accent)", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{e.score}</span>
              </li>
            );
          })}
        </ol>
      )}

      {youLine && (
        <div style={{ ...muted, color: "var(--fl-fg-2)", borderTop: "1px solid var(--fl-border)", marginTop: 12, paddingTop: 10 }}>
          {youLine}
        </div>
      )}
      <div style={{ ...muted, fontSize: 11.5, marginTop: youLine ? 6 : 12 }}>
        The board shows your primary .qie name if you've set one, otherwise a shortened wallet address.
        A new board starts every Monday at 00:00 UTC. No prizes - just bragging rights.
      </div>
    </div>
  );
}
