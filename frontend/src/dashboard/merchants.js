import { ARCADE } from "./v4Config";

/**
 * Curated merchant directory (v1 of discovery - no database needed).
 *
 * Only list merchants that actually deliver something when paid. Anything not
 * live yet is marked "soon" and cannot be subscribed to, so nobody pays for a
 * product that doesn't exist. Self-serve listings (outside merchants applying,
 * with review) come later and need persistence plus moderation.
 */
export const DIRECTORY = [
  {
    id: "arcade",
    name: "Fluenci Arcade",
    category: "Games",
    blurb: "Snake plus an AI assistant for QIE and Fluenci. A weekly leaderboard with prizes is coming next.",
    priceLabel: ARCADE.priceLabel,
    merchant: ARCADE.merchant,
    status: ARCADE.merchant ? "live" : "soon",
    builtByFluenci: true,
    opens: "arcade",
  },
  {
    id: "qie-assistant",
    name: "QIE Assistant",
    category: "Tools",
    blurb: "A Telegram bot: wallet tracker, .qie lookup, price alerts and AI answers about QIE.",
    priceLabel: "$1/month",
    merchant: "",
    status: "soon",
    builtByFluenci: true,
  },
  {
    id: "builder-digest",
    name: "QIE Builder Digest",
    category: "Newsletter",
    blurb: "A weekly roundup of what's shipping across the QIE ecosystem.",
    priceLabel: "$3/month",
    merchant: "",
    status: "soon",
    builtByFluenci: true,
  },
];
