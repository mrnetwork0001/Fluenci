import { useCallback, useEffect, useRef, useState } from "react";
import { sameAddress, signInToArcade } from "./arcadeApi";

/**
 * Fluenci Arcade sign-in for the connected wallet.
 *
 * signIn() asks the wallet for ONE personal_sign of the server's one-time
 * message (no transaction, no gas) and trades it for a session token (12 hours)
 * that the Arcade routes take as "Authorization: Bearer <token>". It only ever
 * runs from a click - nothing here prompts the wallet on its own.
 *
 * The token is kept in memory and in sessionStorage under the wallet's address,
 * so a reload of this tab doesn't ask again. It is dropped when the wallet
 * changes (the previous wallet's stored token too), when it expires, and when
 * the server answers 401 (expire()).
 *
 * `signMessage(message)` is the connected wallet's personal_sign - the v4 hook's
 * wallet, never window.ethereum.
 */

const STORAGE_PREFIX = "fluenci_arcade_session:";
// Treated as expired a minute early, so a request never races the server's clock.
const EXPIRY_MARGIN_MS = 60 * 1000;
const EXPIRED = "Your Arcade sign-in has expired. Sign in again to keep going.";
// A 401: expired, or the server no longer accepts it (e.g. its signing secret changed).
const ENDED = "Your Arcade sign-in has ended. Sign in again to keep going.";

const walletKey = (account) => (account ? String(account).toLowerCase() : "");

function readStored(key) {
  if (!key) return null;
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) || "null");
    if (!s || typeof s.token !== "string" || !s.token || !sameAddress(s.address, key)) return null;
    const exp = Date.parse(s.expiresAt);
    if (!Number.isFinite(exp) || exp - EXPIRY_MARGIN_MS <= Date.now()) return null;
    return { token: s.token, address: s.address, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

function writeStored(session) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + walletKey(session.address), JSON.stringify(session));
  } catch { /* storage blocked: the sign-in still lasts until this page is closed or reloaded */ }
}

function removeStored(key) {
  if (!key) return;
  try { sessionStorage.removeItem(STORAGE_PREFIX + key); } catch { /* storage blocked */ }
}

export function useArcadeSession({ apiBase = null, account = null, signMessage = null }) {
  const key = walletKey(account);
  // Everything below belongs to one wallet. On a switch it is replaced during
  // render, so no frame ever pairs one wallet with another wallet's token.
  const [owner, setOwner] = useState(key);
  const [session, setSession] = useState(() => readStored(key));
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  if (owner !== key) {
    setOwner(key);
    setSession(readStored(key));
    setSigning(false);
    setError("");
  }

  // A switch also forgets the previous wallet's stored token.
  const prevKey = useRef(key);
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = key;
    if (prev && prev !== key) removeStored(prev);
  }, [key]);

  // Only the newest sign-in for the wallet still connected may land.
  const seq = useRef(0);
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);

  const current = session && sameAddress(session.address, key) ? session : null;
  const currentRef = useRef(current);
  useEffect(() => { currentRef.current = current; }, [current]);

  // Drop the token when it runs out, rather than waiting for a 401.
  useEffect(() => {
    if (!current) return undefined;
    const ms = Date.parse(current.expiresAt) - EXPIRY_MARGIN_MS - Date.now();
    const t = setTimeout(() => {
      removeStored(walletKey(current.address));
      setSession(null);
      setError(EXPIRED);
    }, Math.min(Math.max(0, ms), 2 ** 31 - 1)); // past that, setTimeout would fire at once
    return () => clearTimeout(t);
  }, [current]);

  const signIn = useCallback(async () => {
    if (!apiBase || !account || !signMessage) return false;
    const my = ++seq.current;
    const wallet = walletKey(account);
    const stale = () => my !== seq.current || keyRef.current !== wallet;
    setSigning(true);
    setError("");
    const r = await signInToArcade({ apiBase, address: account, sign: signMessage });
    if (stale()) return false;
    setSigning(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    const next = { token: r.token, address: r.address, expiresAt: r.expiresAt };
    writeStored(next);
    setSession(next);
    return true;
  }, [apiBase, account, signMessage]);

  const signOut = useCallback(() => {
    seq.current += 1; // a sign-in still waiting on the wallet no longer lands
    removeStored(key);
    setSession(null);
    setSigning(false);
    setError("");
  }, [key]);

  /** The server answered 401 for `token`: forget it (unless a newer one replaced it) and say why. */
  const expire = useCallback((token) => {
    const s = currentRef.current;
    if (!s || s.token !== token) return;
    removeStored(walletKey(s.address));
    setSession((x) => (x && x.token === token ? null : x));
    setError(ENDED);
  }, []);

  return {
    available: Boolean(apiBase && signMessage),
    signedIn: Boolean(current),
    address: current?.address ?? null,
    token: current?.token ?? null,
    signing,
    error,
    signIn,
    signOut,
    expire,
  };
}
