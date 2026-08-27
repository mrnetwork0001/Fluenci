const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
export const API_BASE_URL = import.meta.env.VITE_API_URL || (isLocalDev ? "http://127.0.0.1:5001" : null);

// --- v2 rebuild flags -------------------------------------------------------
// Plain consts, not import.meta.env: Vite inlines env vars at build time, so a
// flag flip needs a redeploy either way. Keeping them in git means the deployed
// state is greppable instead of hidden in a dashboard.

// Shows the "Fluenci v2 is being built" banner on every view.
export const V2_BUILD_NOTICE = false;

// Blocks new stream creation against the v3 registry while v4 is deployed.
// Existing streams keep settling; only createSubscription is frozen.
// Set back to false in the same window that VITE_REGISTRY_ADDRESS moves to v4.
export const V3_WRITES_FROZEN = false;
