import { ARCADE } from "./v4Config";

/**
 * Curated merchant directory (v1 of discovery - no database needed).
 *
 * Only list merchants that actually deliver something when paid. Anything not
 * live yet is marked "soon" and cannot be subscribed to, so nobody pays for a
 * product that doesn't exist. Self-serve listings (outside merchants applying,
 * with review) come later and need persistence plus moderation.
 *
 * `logo` keys a mark in merchantLogos.jsx; entries without one get the letter avatar.
 */
export const DIRECTORY = [
  {
    id: "arcade",
    logo: "arcade",
    name: "Fluenci Arcade",
    category: "Games",
    blurb: "Snake plus an AI assistant for QIE and Fluenci.",
    priceLabel: ARCADE.priceLabel,
    merchant: ARCADE.merchant,
    status: ARCADE.merchant ? "live" : "soon",
    builtByFluenci: true,
    opens: "arcade",
  },
  {
    id: "qie-assistant",
    logo: "qie-assistant",
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
    logo: "builder-digest",
    name: "QIE Builder Digest",
    category: "Newsletter",
    blurb: "A weekly roundup of what's shipping across the QIE ecosystem.",
    priceLabel: "$3/month",
    merchant: "",
    status: "soon",
    builtByFluenci: true,
  },
];

/** Logo key for a merchant wallet, so a listed merchant shows its mark wherever it appears. */
export const logoFor = (address) => {
  const a = String(address || "").toLowerCase();
  return a ? DIRECTORY.find((m) => m.merchant && m.merchant.toLowerCase() === a)?.logo : undefined;
};
