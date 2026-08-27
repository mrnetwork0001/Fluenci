# Fluenci Roadmap - v2

Source of truth for the v2 rebuild. The originating spec is reproduced verbatim at the
bottom; everything above it is that spec sequenced into build order.

## Positioning

**"Stripe-style subscriptions for Web3"** - not "AI-shielded payment streams."

Payment streaming, QUSDC and QIEDex routing stay as the core infrastructure, but the
technical complexity is hidden from normal users.

**The differentiator:** verified recurring payments + QIE identity + QIE reputation +
programmable spending limits. That is more defensible than being another
payment-streaming protocol.

**The network effect being built toward:**

> more merchants → more subscribers → more QIE Wallet users → more QIE IDs / QIE Pass /
> Reputation usage → more QUSDC and QIE transactions → more value for merchants to join

---

## Phase 1 - v4 registry (contract)

One redeploy. Every onchain change batches here; a second migration later is far more
expensive than getting this right once.

- [ ] **Period-based accrual.** Replace `ratePerSecond` with `amountPerPeriod` +
      `periodSeconds`, accruing `amountPerPeriod * elapsed / periodSeconds`.
- [ ] **Merchant-configurable gating.** Per-merchant policy: `OPEN` / `QIE_ID` /
      `QIE_PASS` / `MIN_REPUTATION`, replacing the unconditional KYC requirement on
      `createSubscription`.
- [ ] **Per-merchant spending caps.** Scoped to the `(subscriber, merchant)` pair, not
      per-subscription - otherwise a merchant opens three streams and takes 3×. Raising a
      cap requires subscriber approval.
- [ ] **Preserve:** NFT transferability, AI safety pause, disputes, the 0.5% protocol fee,
      auto-settle on terminate.
- [ ] **Test suite.** Non-negotiable this round - v4 rewrites the money math.

## Phase 2 - consumer surface

- [ ] Remove technical inputs from the consumer UI (tokens/hour, cliff seconds). Users see
      `$20/month` or `$0.03/minute`.
- [ ] Merchant identity card before subscribing: QIE ID, verification status, reputation
      score, malicious-wallet flags.
- [ ] Collapse the four-agent AI dashboard into one **Fluenci Protect** - anomaly
      detection, alerts, emergency pausing.
- [ ] Demote Snake and AI Chat to demos, out of the core product.

## Phase 3 - growth loop

- [ ] **Persistence.** The server has no database today; telemetry is an in-memory array.
      Payment links and the directory need records that survive a restart.
- [ ] **No-code merchant payment links** - `fluenci.xyz/pay/company.qie`, no development
      required of the merchant.
- [ ] **Merchant directory / marketplace** so users can discover verified businesses
      accepting Fluenci. This is the network-effect piece.

## Phase 4 - integration

- [ ] **"Pay with Fluenci"** for any dApp, SaaS product or website. Ship the checkout
      link + snippet pattern first; a full SDK after.

---

## Build constraints (verified, not assumed)

- **qUSDC has 6 decimals** and v3 stores an integer `ratePerSecond`. At that precision
  `$20/month` bills `$18.14`, `$5/month` bills `$2.59`, and `$1/month` reverts on
  `require(ratePerSecond > 0)`. This is why Phase 1 leads with the accrual model - the
  "show $20/month" requirement is not representable without it.
- **ERC-20 allowance is registry-global.** It cannot distinguish `merchant-a.qie` from
  `merchant-b.qie`, so per-merchant caps must be enforced inside the registry or the
  feature is cosmetic.
- **Contract addresses were hardcoded** in `frontend/src/hooks/useFluenci.js`. Now
  overridable via `VITE_REGISTRY_ADDRESS`, so v4 cutover is an env change, not a code edit.
- **`npm install` fails on a clean clone.** `lucide-react@0.379.0` peers React ≤18 while
  the project is on React 19 - needs `--legacy-peer-deps`.

## Open dependencies

- **QIE ID + QIE Reputation contract addresses / ABIs.** Blocking for the reputation gate
  and the merchant identity card. Mitigation: the gate ships as an adapter behind an
  interface, so Phase 1 does not wait - `OPEN` and `QIE_PASS` work on day one and the
  reputation adapter is wired when the address lands. No second migration.
- **"Pay-as-you-use" scope.** Time-based (`$0.03/minute`) streams natively. True metered
  billing (per API call, per GB) needs merchant-reported usage, for which the stream model
  has no input. Confirm which is meant.

## v3 → v4 cutover checklist

Do these in one window:

1. Set `VITE_REGISTRY_ADDRESS` in Vercel to the v4 address.
2. Update `REGISTRY_ADDRESS` and `START_BLOCK` in `server/server.js` **together** - moving
   one without the other leaves the indexer scanning ~1.4M empty blocks.
3. Update the hardcoded v3 fallback in `server/check_subscriptions.js`.
4. Ship any changed `REGISTRY_ABI` in the same commit as the address. A stale ABI against a
   live contract is the one path that produces a genuinely broken site.
5. Redeploy frontend and backend together.
6. Set `V3_WRITES_FROZEN = false` in `frontend/src/config.js`.
7. Leave the 4 dormant v3 streams to expire - all team wallets, nothing to migrate.

---

## Source spec (verbatim)

> I think Fluenci has real potential, but I would simplify the product and focus on the part
> that can actually scale QIE: recurring and pay-as-you-use crypto payments with identity,
> reputation and spending protection built in.
>
> My recommended changes:
>
> - Position it simply: "Stripe-style subscriptions for Web3" rather than "AI-shielded
>   payment streams."
> - Keep payment streaming, QUSDC and QIEDex routing as the core infrastructure, but hide
>   the technical complexity from normal users.
> - Do not force QIE Pass KYC for every subscription. Make it optional or
>   merchant-configurable: Open / QIE ID required / QIE Pass verified / minimum Reputation
>   Score.
> - Integrate QIE ID + QIE Reputation properly. Before subscribing, users should see the
>   merchant's QIE ID, verification status, reputation score and any malicious-wallet flags.
> - Add merchant spending limits. Example: user authorises merchant.qie for a maximum of
>   $20/month. Merchant can never take more unless the user approves an increase.
> - Remove technical inputs from the consumer UI such as tokens/hour, cliff seconds etc. The
>   user should simply see "$20/month" or "$0.03/minute."
> - Add no-code merchant payment links so a merchant can create a subscription page like
>   fluenci/pay/company.qie without development.
> - Add SDK/API integration so any dApp, SaaS product or website can add "Pay with Fluenci"
>   quickly.
> - Create a merchant directory/marketplace where users can discover verified businesses
>   accepting Fluenci. This is important for network effects.
> - Simplify the AI security layer. The multi-agent dashboard feels more like hackathon/demo
>   complexity. One clear "Fluenci Protect" system for anomaly detection, alerts and
>   emergency pausing is enough.
> - Keep Snake / AI Chat only as demos, not core product features.
>
> The reason for these changes is that the network effect should be: more merchants → more
> subscribers → more QIE Wallet users → more QIE IDs/QIE Pass/Reputation usage → more QUSDC
> and QIE transactions → more value for merchants to join.
>
> The unique part should become: Verified recurring payments + QIE identity + QIE reputation
> + programmable spending limits. That is much stronger and more defensible than simply
> being another payment-streaming protocol.
