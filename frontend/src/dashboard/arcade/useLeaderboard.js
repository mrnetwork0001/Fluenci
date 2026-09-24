import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { fetchLeaderboard } from "./arcadeApi";
import { resolveQieName } from "../qieName";
import { MAINNET_RPC } from "../v4Config";

const POLL_MS = 60000;
const NO_ENTRIES = [];

// .qie names live on QIE mainnet, whichever chain the Arcade itself reads.
let nameProvider = null;
const getNameProvider = () => nameProvider || (nameProvider = new ethers.JsonRpcProvider(MAINNET_RPC));

/**
 * This week's Snake board, read every minute while `enabled`, plus the primary
 * .qie name of each listed wallet (null when it has none, so the panel shows a
 * shortened address). With a token the server adds the caller's own standing;
 * a board read for another token (another wallet) is never shown as this one.
 * When the server refuses the token (401), `onUnauthorized(token)` drops the
 * sign-in, and the next read is the public board - never a stale "you".
 */
export function useLeaderboard({ apiBase = null, token = null, enabled = true, onUnauthorized = null }) {
  const [board, setBoard] = useState({ token: null, status: "loading", week: "", entries: NO_ENTRIES, you: null });
  const [names, setNames] = useState({}); // lowercase address -> name | null
  const [tick, setTick] = useState(0);
  const asked = useRef(new Set());
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { onUnauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  const active = enabled && Boolean(apiBase);

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const load = async () => {
      const r = await fetchLeaderboard({ apiBase, token });
      if (!live) return;
      if (!r.ok && r.unauthorized && token) {
        // Nothing this token was told about "you" holds any more. Dropping the
        // sign-in changes the token (to null), which reloads the public board.
        setBoard((b) => (b.token === token ? { ...b, token: null, you: null } : b));
        onUnauthorizedRef.current?.(token);
        return;
      }
      setBoard((b) => {
        if (r.ok) return { token, status: "ready", week: r.week, entries: r.entries, you: r.you };
        // Keep the last good board on screen through a failed refresh (its `you`
        // stays tied to the token it was read with).
        return b.status === "ready" ? b : { token, status: "failed", week: "", entries: NO_ENTRIES, you: null };
      });
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [active, apiBase, token, tick]);

  // The list is the same for everyone; only `you` belongs to one token.
  const forToken = board.token === token;
  const entries = board.entries;

  // Names are looked up once per wallet; they don't change often enough to re-ask.
  useEffect(() => {
    const pending = [...new Set(entries.map((e) => e.address.toLowerCase()))].filter((a) => !asked.current.has(a));
    if (pending.length === 0) return;
    pending.forEach((a) => asked.current.add(a));
    Promise.all(pending.map(async (a) => [a, await resolveQieName(a, getNameProvider())]))
      .then((pairs) => setNames((m) => ({ ...m, ...Object.fromEntries(pairs) })));
  }, [entries]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return {
    status: forToken || board.status === "ready" ? board.status : "loading",
    week: board.week,
    entries,
    you: forToken ? board.you : null,
    // true once `you` is this token's answer (null then means "not on the board")
    youKnown: forToken && board.status === "ready",
    names,
    refresh,
  };
}
