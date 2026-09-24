const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
export const API_BASE_URL = import.meta.env.VITE_API_URL || (isLocalDev ? "http://127.0.0.1:5001" : null);

// --- v2 rebuild flags -------------------------------------------------------
// Plain consts, not import.meta.env: Vite inlines env vars at build time, so a
// flag flip needs a redeploy either way. Keeping them in git means the deployed
// state is greppable instead of hidden in a dashboard.

// Shows the "Fluenci v2 is being built" banner on every view.
export const V2_BUILD_NOTICE = false;

// Freezes the legacy v3 registry (the v1 dashboard's). Its owner key is burned
// and its QIE Pass gate is the retired mock anyone can self-verify on, so the
// app puts nothing new into it: no new streams, no new qUSDC approvals, no
// merchant claims. Cancelling a stream and revoking an approval stay available,
// so existing subscribers can always get out.
export const V3_WRITES_FROZEN = true;
