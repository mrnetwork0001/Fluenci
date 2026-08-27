# Phase 2 — Branded Merchant Payment Pages

Status: **Not built.** Deferred to Phase 2 by the QIE sponsor. Notes for when we pick this up.

## What it is

A merchant shares one link and a subscriber lands on a **pre-configured, branded subscribe page** —
merchant name/logo, a fixed price and period, one button. Like a Stripe Payment Link.

Target: `fluenci.xyz/pay/acme.qie` → "Subscribe to Acme — $20/month" with Acme's branding, subscriber
just connects and confirms.

## What already exists (Phase 1, shipped)

The **routing + pre-fill** is done and live:

- `fluenci.xyz/pay/<name.qie>` routes to the subscribe screen (App.jsx `getInitialRoute`, `pay/` prefix).
- It pre-fills the "Pay to" field with the merchant and auto-resolves them (`DashboardV2` `payMerchant`
  → `NewSubscription` `initialMerchant`).
- The merchant dashboard advertises the link (`MerchantDashboardV2` `paymentLink`).

So the link works today — it just opens a blank-amount subscribe form pre-filled with the merchant.
The subscriber still types the price themselves.

## The cheap next step (frontend-only, no backend)

Carry the price in the URL as query params, so the amount pre-fills too:

    fluenci.xyz/pay/acme.qie?amount=20&period=month

- Parse `amount` / `period` in `getInitialRoute`, thread through `payMerchant` → `NewSubscription`.
- Pre-fill and (optionally) lock the amount/period fields.
- No persistence needed — the merchant's dashboard just generates this URL from whatever price they type.

This gets ~80% of the "branded link" value. Do this first; it's an afternoon.

## The full version (needs backend persistence)

What actually requires Phase 2 infrastructure:

1. **Saved merchant page config** — logo, display name, description, one or more preset plans
   (price + period + optional trial). Stored server-side keyed by the merchant's `.qie` name or address.
2. **A real branded page** at `/pay/<name>` that fetches that config and renders the merchant's
   identity card, plan(s), and branding — not just a pre-filled form.
3. **Backend work required:** the server (`server/server.js`) currently has **no database** — telemetry
   is an in-memory array. Payment pages need a persistence layer (Postgres/SQLite on the VPS) plus
   CRUD endpoints for merchants to create/edit their page. This is the same persistence dependency the
   merchant **directory/marketplace** (also Phase 2) needs, so build it once for both.
4. **Auth** — a merchant edits only their own page. Prove ownership by signing with the wallet that
   owns the `.qie` name (verify via the resolver / a signed message).

## Dependencies / sequencing

- Backend DB is the gating item — shared with the merchant directory. Do it once.
- The QIE reputation/identity data (still pending QIE's API) enriches the page's merchant card but is
  not a blocker for the page itself.

## Files that will change

- `frontend/src/App.jsx` — richer `/pay` route parsing (query params, then a dedicated page view).
- `frontend/src/dashboard/NewSubscription.jsx` — accept a locked price/period.
- `frontend/src/dashboard/MerchantDashboardV2.jsx` — a "customise payment page" editor.
- `server/server.js` + a new DB module — config storage + endpoints.
- A new `PayPage` component for the branded standalone view.
