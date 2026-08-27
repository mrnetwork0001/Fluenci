// Review fixtures. Used ONLY when VITE_REGISTRY_V4_ADDRESS is unset, so the v2
// screens can be reviewed before v4 is on mainnet. Never shown against a
// configured registry - see DashboardV2's `usingSample` flag and its banner.
const U = (n) => BigInt(Math.round(n * 1_000_000));
const MONTH = 2_592_000;

export const sampleSubscriptions = [
  { id: "0x01", merchant: "0x4d21000000000000000000000000000000009c07", merchantName: "notion.qie",
    amountPerPeriod: U(20), periodSeconds: MONTH, active: true, pausedByAI: false, dispute: 0,
    gate: 2, reputation: 842,
    cap: { maxAmount: U(20), used: U(12), periodSeconds: MONTH } },
  { id: "0x02", merchant: "0x77aa000000000000000000000000000000001b34", merchantName: "cursor.qie",
    amountPerPeriod: U(20), periodSeconds: MONTH, active: true, pausedByAI: false, dispute: 0,
    gate: 3, reputation: 812, cap: null },
  { id: "0x03", merchant: "0x91cc0000000000000000000000000000000042de", merchantName: "hosting.qie",
    amountPerPeriod: U(7), periodSeconds: MONTH, active: true, pausedByAI: false, dispute: 0,
    gate: 0, reputation: null,
    cap: { maxAmount: U(7), used: U(7), periodSeconds: MONTH } },
];

export const sampleLimits = sampleSubscriptions.map((s) => ({
  merchant: s.merchant,
  merchantName: s.merchantName,
  maxAmount: s.cap?.maxAmount ?? null,
  periodSeconds: s.cap?.periodSeconds ?? null,
  used: s.cap?.used ?? 0n,
  set: Boolean(s.cap),
}));

export const sampleActivity = [];

export const sampleMerchant = {
  claimable: U(83.14),
  monthlyRecurring: U(420),
  settledAllTime: U(2914),
  subscriberCount: 21,
  reputationScore: 842,
  merchantName: "notion.qie",
};
