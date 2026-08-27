# Fluenci - Stripe-style subscriptions for Web3

Recurring payments on the QIE Blockchain (Chain ID 1990), settled in `qUSDC`. A merchant
charges `$20/month`. A subscriber sees `$20/month`. Payment streaming, qUSDC and QIEDex
routing run underneath, but nobody has to think about tokens per second.

The part that is hard to copy is the combination:

- **Verified recurring payments** - period-based billing settled onchain, exact to the cent.
- **QIE identity** - merchants choose whether subscribers need a QIE ID or a verified QIE Pass.
- **QIE reputation** - a minimum-score gate, consumed as a signed attestation from QIE's
  offchain reputation service.
- **Programmable spending limits** - a subscriber caps a merchant at, say, $20 per month.
  The cap is enforced onchain. The merchant cannot exceed it, and only the subscriber can
  raise it.

**dApp:** https://fluenci.xyz

---

## Status

Read this before anything else in the file.

| | State |
|---|---|
| FluenciRegistry **v3** | Live on QIE mainnet. This is what `fluenci.xyz` talks to today. |
| FluenciRegistry **v4** | **Live on QIE mainnet** at `0xCc92ab9B5D973ad9598C53aC28350C34895a2e33`. 66 passing tests, three adversarial audit rounds. |
| FluenciReputationAttestor | **Live on QIE mainnet** at `0x1e89d42C5459b4E8e26b4991DA0f7E0C97CD33B7`. The reputation gate activates once QIE issues its signing key. |
| v2 dashboard (consumer UI, Fluenci Protect, spending limits) | **Live** — the public app on `fluenci.xyz` runs v2 against the v4 contracts. |
| No-code merchant payment links | **Not built.** Next phase. |
| SDK / "Pay with Fluenci" embed | **Not built.** Next phase. |
| Merchant directory / marketplace | **Not built.** Next phase. |

Sequencing and the cutover checklist are in [`ROADMAP.md`](./ROADMAP.md).

---

## FluenciRegistryV4

### Period-based pricing

v3 stored an integer `ratePerSecond`. qUSDC has 6 decimals, so at that precision a
consumer price is not representable:

| Intended price | What v3 actually bills |
|---|---|
| $20 / month | $18.14 |
| $5 / month | $2.59 |
| $1 / month | reverts - `ratePerSecond` truncates to 0 |

v4 stores `amountPerPeriod` + `periodSeconds` and accrues against a single cumulative
`billedSeconds` counter. `$20/month` is `amountPerPeriod = 20_000000`,
`periodSeconds = 2_592_000`, and it is exact. Because everything owed is derived from one
cumulative figure rather than per-claim deltas, a merchant claiming monthly and a merchant
claiming every second are paid identically; truncation is bounded at one token unit over the
life of the stream instead of compounding on every claim. Periods run from 60 seconds to
3,650 days.

### Merchant-configurable access

v3 required a verified QIE Pass from every subscriber before a stream could exist. v4 lets
each merchant pick:

| Gate | Requirement on the subscriber |
|---|---|
| `OPEN` | None. **This is the default** for any merchant who has not configured a policy. |
| `QIE_ID` | Holds a QIE identity |
| `QIE_PASS` | Holds a verified QIE Pass |
| `MIN_REPUTATION` | Reputation score at or above the merchant's threshold |

**No KYC is required to subscribe.** Merchants still need a verified QIE Pass to *withdraw*
(`requireMerchantKyc`, owner-toggleable without a redeploy) - that is the progressive-KYC
model, and it is the only place identity is mandatory.

Each identity source sits behind its own interface. An unconfigured adapter makes its gate
revert rather than silently pass, and every external identity read is wrapped in `try/catch`
so a reverting adapter fails the gate closed instead of bricking the registry.

### Programmable spending limits

`setSpendCap(merchant, maxAmount, periodSeconds)` caps what one merchant may pull from the
caller per window. Notes on the design:

- The cap is scoped to the **(subscriber, merchant) pair**, not to a subscription. Per
  subscription, a merchant could open three streams and draw the cap three times.
- ERC-20 allowance cannot do this. An allowance to the registry is global; it cannot tell
  `merchant-a.qie` from `merchant-b.qie`. Enforcement has to live inside the registry or the
  feature is cosmetic.
- A claim over the cap is **clamped, not reverted**. The merchant receives what it is owed up
  to the cap, a `SpendCapReached` event fires, and the remainder stays accrued.
- Only the subscriber can call `setSpendCap`, so any increase is subscriber-approved by
  construction.
- Windows are fixed, not rolling. A sliding window needs per-claim history that is expensive
  onchain, and "resets on the 1st" is easier to explain.

### Subscription NFTs are transferable, but receipt is opt-in

Each subscription is still an ERC-721 token, and billing follows ownership. That is exactly
why receiving one now requires consent.

An audit of the v3 design found the following: because billing follows the token, and because
an *unset* spending cap reads as unlimited, an attacker could mint a punitive stream to their
own merchant address and transfer the NFT to any wallet holding a standing allowance to the
registry. The recipient becomes the payer, uncapped, without ever having agreed to anything.

v4 requires `setAcceptsSubscriptionTransfers(true)` on the recipient before a transfer
lands, re-checks the merchant's gate against the incoming payer, and forces the outgoing
owner's arrears to settle to zero first - otherwise the old owner's debt would be charged to
the new one, outside whatever cap they had set.

### Fluenci Protect

The four-agent dashboard (Sentry / Analyst / Decision / Arbitrator) is collapsed into one
system: anomaly detection, alerts, and emergency pausing, with one control that matters - the
risk level at which a stream is paused.

**Protect never holds or escrows funds.** Creating a subscription locks nothing up, so there
is no pot for the monitoring layer to seize, and the routine Protect action is a pause
(`pauseStreamByAI`), which moves no tokens.

Be precise about the authority, though. `pauseStreamByAI` requires `msg.sender == aiAuditor`,
and `resolveDispute` requires a signature that recovers to
`IFluenciAIAuditor(aiAuditor).trustedAiWorker()` - the same AI Auditor key, and that second
path does move money. What contains it is not a separation of keys but the bounds on the
payout:

- Only the subscriber can open the dispute. `openDispute` is `onlySubscriber`; neither the
  merchant nor Protect can start one.
- The payout is capped at what has already accrued - `require(merchantShare <= outstanding)`.
  Nothing unaccrued and nothing future-dated can be reached.
- It is then clamped by the subscriber's spend cap for that merchant, exactly as an ordinary
  claim is.
- It can only pay that subscription's own merchant, in that subscription's own token.

So an AI Auditor signature can settle an already-accrued balance to the merchant the
subscriber was already paying. It cannot direct funds anywhere else.

### Pull-based custody

Creating a subscription locks nothing. Stream parameters are registered onchain and funds
are pulled from the subscriber's wallet as they accrue, via `transferFrom` on claim.
Subscribers keep custody throughout. A claim fails cleanly if the balance is short.

---

## QIE ecosystem integration - what is whose

This section was wrong in earlier versions of this README. Corrected.

### Contracts QIE deployed

| Contract | Address |
|---|---|
| qUSDC (6 decimals) | [`0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`](https://mainnet.qie.digital/address/0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5) |
| QIEDex Router | [`0x08cd2e72e156D8563B4351eb4065C262A9f553Ef`](https://mainnet.qie.digital/address/0x08cd2e72e156D8563B4351eb4065C262A9f553Ef) |
| QIE reverse resolver (address → primary `.qie` name) | [`0x76ec8ed377cC0d36D1B48027ac7892Ec6799171E`](https://mainnet.qie.digital/address/0x76ec8ed377cC0d36D1B48027ac7892Ec6799171E) |
| QIE domain registry (forward) | [`0x26cCB3fABd6db18834987134d715Ba2346CE7223`](https://mainnet.qie.digital/address/0x26cCB3fABd6db18834987134d715Ba2346CE7223) |
| QIE domain registry (forward) | [`0x1D69d75AD7b77b91C3760F84faC52E651710f62e`](https://mainnet.qie.digital/address/0x1D69d75AD7b77b91C3760F84faC52E651710f62e) |

QIE runs two forward registries and a name lives in exactly one of them, so forward
resolution queries both. Reverse resolution is a single `resolve(address)` call - v1 paged
the block explorer and decoded registration calldata, which was slow and wrong whenever a
name had been transferred rather than registered.

### QIE Pass - Fluenci runs an oracle bridge, not a QIE contract

`0x0766Ff824376CEf38CFa5C155A51E90578096e38` was previously listed here as "QIE Pass (KYC)"
under QIE ecosystem integrations. **That is a Fluenci-deployed contract, not QIE
infrastructure.** Its creator is `0xfe5F1D13A31a5B86833ADF4486720331D6e4a6bb` - Fluenci's own
AI worker hot wallet, listed as such in the deployment table below. It is unverified. Both of
those facts are checkable on the QIE explorer today.

Do not read verification status as the tell. The QIE contracts listed above are not uniformly
verified either - qUSDC and one of the two forward registries are verified; the QIEDex router,
the reverse resolver and the other forward registry are not - and they do not share a single
deployer (`0x9a689036A798cF1a96e65c1911cE7B444C4e06a4` deployed the name registries; qUSDC and
the QIEDex router came from other addresses). What distinguishes `0x0766Ff82…` is its creator:
a Fluenci key.

What it really is:

```
Fluenci backend  ──►  pass-api.qie.digital        (QIE's real QIE Pass API, HMAC-SHA256)
                 ◄──  signed credential + proof
                      verify signature, expiry, revocation
                 ──►  registerIdentity(wallet, true)
                      on 0x0766Ff82…  (Fluenci's oracle bridge, written by the hot wallet)

FluenciRegistry  ──►  verifyIdentity(wallet)  on 0x0766Ff82…
```

The verification itself is genuinely QIE's. The onchain record of it is Fluenci's, written by
a Fluenci-controlled key. That is a legitimate oracle-bridge architecture and it is how the
QIE Pass gate works today - but it should not be read as QIE having deployed a registry for
us. If QIE ships a canonical onchain QIE Pass registry, `setQiePass()` repoints the registry
at it with no migration.

### QIE Reputation - offchain, consumed via signed attestation

**QIE Reputation has no onchain contract.** Four independent sweeps of the chain confirmed
this. It is an offchain HTTP service at `reputation.qie.digital`, and the score is computed
from signals (wallet age, transaction history, staking, verified reports) that change over
time. Any claim of an onchain QIE reputation registry is false.

`FluenciReputationAttestor` bridges it without inventing a contract that does not exist:

1. QIE's reputation service signs an EIP-712 attestation over
   `(wallet, score, tier, modelVersion, issuedAt, expiresAt, chainId)`.
2. Anyone may relay it to `submitAttestation()` - the signature is the authority, not
   `msg.sender`, so a user, a merchant, or Fluenci's backend can submit on a subscriber's
   behalf without being trusted.
3. The contract checks the signature against an upgradeable `authorisedSigner`, rejects a
   wrong chain, an expired or future-dated window, a retired `modelVersion`, and any
   attestation older than the one already on record.
4. `getScore(address)` returns 0 once the attestation expires, so the registry's gate fails
   closed.

**The signer is not yet configured.** QIE has not provided the key. Until it does,
`MIN_REPUTATION` cannot be satisfied by anyone - the adapter is built and tested, the gate is
inert. `OPEN` and `QIE_PASS` work on day one, which is why this does not block the v4
deployment.

Only the reputation **result** is ever stored onchain - score, tier, model version, validity
window. No KYC data, no documents, no underlying signals.

---

## Deployments (QIE Mainnet, Chain ID 1990)

### Live today - Fluenci v3

| Contract | Address |
|---|---|
| **FluenciRegistryV4** (current) | [`0xCc92ab9B5D973ad9598C53aC28350C34895a2e33`](https://mainnet.qie.digital/address/0xCc92ab9B5D973ad9598C53aC28350C34895a2e33) |
| **FluenciReputationAttestor** | [`0x1e89d42C5459b4E8e26b4991DA0f7E0C97CD33B7`](https://mainnet.qie.digital/address/0x1e89d42C5459b4E8e26b4991DA0f7E0C97CD33B7) |
| FluenciRegistry (v3, legacy) | [`0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9`](https://mainnet.qie.digital/address/0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9) |
| FluenciAIAuditor | [`0xF38d9458d14d916B60026693a76FBe7cDEf651Fa`](https://mainnet.qie.digital/address/0xF38d9458d14d916B60026693a76FBe7cDEf651Fa) |
| FluenciRouter | [`0x75475647f52531D4086296415392E4AA94b92de7`](https://mainnet.qie.digital/address/0x75475647f52531D4086296415392E4AA94b92de7) |
| QIE Pass oracle bridge (Fluenci-deployed, unverified) | [`0x0766Ff824376CEf38CFa5C155A51E90578096e38`](https://mainnet.qie.digital/address/0x0766Ff824376CEf38CFa5C155A51E90578096e38) |
| AI worker hot wallet (EOA) | `0xfe5F1D13A31a5B86833ADF4486720331D6e4a6bb` |

The public app now serves v2 against v4; the v3 dashboard remains reachable at `/v1`. Historically v3 writes were frozen (`V3_WRITES_FROZEN`) while v4
lands. Existing v3 streams keep settling.

### Not yet deployed

`FluenciRegistryV4` was deployed at block 10031934. The v2 frontend and the deploy record point to the addresses above; redeploy (a fresh address) is only needed for a contract-logic change, never a config one (treasury, signer, auditor and fee are all setter-adjustable).
`contracts/scripts/deployV4.ts`; the frontend picks them up from
`VITE_REGISTRY_V4_ADDRESS` and `VITE_REPUTATION_ATTESTOR_ADDRESS`, so cutover is an
environment change rather than a code edit.

---

## Quick start

Requires Node.js 18+ and a wallet on QIE Mainnet (Chain ID 1990).

### Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

66 tests cover v4 and the attestor, across `FluenciV4`, `FluenciV4.security` and
`FluenciAttestation`. `test/Fluenci.test.ts` is the legacy v3 suite - a further 10 tests,
still passing against the v3 registry.

Local end-to-end, with mocks and a seeded subscription:

```bash
npx hardhat node                                        # terminal 1
npx hardhat run scripts/deployV4.ts --network localhost # terminal 2
```

### Backend

Indexes onchain events, runs the Protect monitoring loop, bridges QIE Pass, and serves
telemetry.

```bash
cd server
npm install
npm start
```

`server/.env`:

```ini
PORT=5001
RPC_URL=https://rpc1mainnet.qie.digital
REGISTRY_ADDRESS=0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9
AUDITOR_ADDRESS=0xF38d9458d14d916B60026693a76FBe7cDEf651Fa
AI_PRIVATE_KEY=
OPENAI_API_KEY=
QIEPASS_API_URL=https://pass-api.qie.digital
QIEPASS_PUBLIC_KEY=
QIEPASS_SECRET_KEY=
QIEPASS_CLAIMS=firstName
START_BLOCK=8320000
```

Move `REGISTRY_ADDRESS` and `START_BLOCK` together at cutover. Moving one without the other
leaves the indexer scanning roughly 1.4M empty blocks.

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

`--legacy-peer-deps` is required: `lucide-react@0.379.0` peers React ≤18 and the project is on
React 19. A plain `npm install` fails on a clean clone.

`frontend/.env`:

```ini
VITE_API_URL=http://127.0.0.1:5001
VITE_REGISTRY_ADDRESS=              # v3 registry
VITE_REGISTRY_V4_ADDRESS=0xCc92ab9B5D973ad9598C53aC28350C34895a2e33   # live; also baked as the code default
VITE_REPUTATION_ATTESTOR_ADDRESS=
VITE_REPUTATION_API_URL=            # QIE reputation service base URL
```

There is no database. Telemetry is an in-memory array and does not survive a restart.
Persistence is a prerequisite for payment links and the directory.

---

## Project structure

```
Fluenci/
├── contracts/
│   ├── contracts/
│   │   ├── FluenciRegistryV4.sol          # period pricing, gates, spend caps, opt-in NFTs
│   │   ├── FluenciReputationAttestor.sol  # EIP-712 signed reputation attestations
│   │   ├── FluenciRegistry.sol            # v3, live on mainnet
│   │   ├── FluenciAIAuditor.sol           # safety-pause authority
│   │   ├── FluenciRouter.sol              # QIEDex swaps with onchain attribution
│   │   └── Mock*.sol                      # qUSDC, QIE Pass, QIE Dex, reputation - tests only
│   ├── scripts/deployV4.ts
│   └── test/                              # FluenciV4, FluenciV4.security, FluenciAttestation
│
├── server/
│   ├── server.js                          # event indexer, Protect loop, QIE Pass bridge, telemetry
│   └── check_subscriptions.js
│
├── frontend/src/
│   ├── config.js                          # V2_BUILD_NOTICE, V3_WRITES_FROZEN
│   ├── dashboard/                          # the v2 consumer surface (v4)
│   │   ├── NewSubscription.jsx            # "$20/month" - no rate or cliff inputs
│   │   ├── SpendingLimits.jsx             # per-merchant caps
│   │   ├── Protect.jsx                    # Fluenci Protect, one surface
│   │   ├── SubscriberDashboard.jsx  MerchantDashboardV2.jsx  Swap.jsx
│   │   ├── qieName.js                     # .qie forward + reverse resolution
│   │   ├── v4Config.js                    # v4 addresses and ABI, all env-driven
│   │   └── useFluenciV4.js
│   ├── components/                        # v1 surface + demos
│   │   ├── SubscriberPanel.jsx  MerchantDashboard.jsx  AISecurityDesk.jsx
│   │   ├── FluenciDocs.jsx  BlogPage.jsx
│   │   ├── FluenciAIChat.jsx              # demo
│   │   └── QieDoodleGame.jsx              # demo (Snake)
│   └── hooks/useFluenci.js                # v3 hook
│
├── design/                                # dashboard design canvas
└── ROADMAP.md
```

The Snake arcade and the AI chat are demos of micro-streaming and nothing more. They are not
product features and are not on the roadmap.

---

## Economic model

**Protocol fee - the only revenue mechanism that exists.** 0.5% is taken when a merchant
settles. 99.5% goes to the merchant, 0.5% to the treasury. On a normal claim, `_settle`
computes the fee against the cumulative settled amount less the fee already taken
(`settledFees`), so claim frequency does not change the total.
The contract hard-caps the fee at 5% (`protocolFeeBps`, max 500), so the owner cannot raise it
past that. If no treasury is set, no fee is taken.

That scales with settled volume and nothing else. It is the whole model today.

Not built, and not to be described as revenue: premium Protect tiers, dispute-resolution fees,
yield on escrowed collateral, sentinel-node staking, referral splits, stream-to-earn. Disputes
exist onchain (`openDispute` / `resolveDispute`), authorised by an EIP-191 `personal_sign`
signature from the AI Auditor's trusted worker key - not EIP-712, which is used only by
`FluenciReputationAttestor`. Dispute resolution is **not** free: `resolveDispute` takes the
same 0.5% protocol fee out of the merchant's payout and transfers it to the treasury. Unlike
`_settle` it computes that fee on the payout alone and never touches `settledFees`, so it
sits outside the cumulative fee accounting described above. There is no *separate*
dispute-resolution fee, and none is planned - but the protocol fee still applies.

---

## Where this is going

The network effect being built toward: more merchants → more subscribers → more QIE Wallet
users → more QIE ID / QIE Pass / Reputation usage → more qUSDC and QIE transactions → more
reason for the next merchant to join.

The three pieces that drive it - payment links, the SDK, and the merchant directory - are the
next phase and are **not built**. Ordering and constraints are in [`ROADMAP.md`](./ROADMAP.md).

---

## Links

- X: [x.com/fluenciAI](https://x.com/fluenciAI)
- GitHub: [github.com/mrnetwork0001/Fluenci](https://github.com/mrnetwork0001/Fluenci)

## License

© 2026 Fluenci Protocol. Built for QIE Blockchain. All rights reserved.
