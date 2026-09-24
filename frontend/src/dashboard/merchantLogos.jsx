import { useId } from "react";

// Marks for the merchants Fluenci builds. Each is drawn on a 44-unit grid and carries
// its own tile, so it replaces the letter avatar outright. The colours are logo
// artwork, not UI tokens: the accent, the Snake head (#0ab6d8) and the Snake food.
const ACCENT = "#079AB7";
const HEAD = "#0ab6d8";
const FOOD = "#f59e0b";
const LINE = { fill: "none", stroke: ACCENT, strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" };

function Tile({ uid, size, defs = null, children }) {
  // The border is one CSS pixel at any size (1 unit at 44, 1.375 at 32).
  const h = 44 / size;
  const box = { x: h / 2, y: h / 2, width: 44 - h, height: 44 - h, rx: 11 - h / 2 };
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false"
         style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`${uid}t`} x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#151515" />
          <stop offset="1" stopColor="#0e0e0e" />
        </linearGradient>
        <radialGradient id={`${uid}g`} cx="22" cy="22" r="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={ACCENT} stopOpacity="0.1" />
          <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
        </radialGradient>
        {defs}
      </defs>
      <rect {...box} fill={`url(#${uid}t)`} stroke="#222222" strokeWidth={h} />
      <rect {...box} fill={`url(#${uid}g)`} />
      {children}
    </svg>
  );
}

// Snake mid-game: tail fading like the game draws it, head about to eat the food.
// Rows sit on pixel edges at 32px so the 2px body stays crisp there.
export function ArcadeLogo({ size = 44 }) {
  const uid = useId();
  return (
    <Tile uid={uid} size={size} defs={
      <linearGradient id={`${uid}b`} x1="0" y1="12.75" x2="0" y2="31.25" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={ACCENT} stopOpacity="0.65" />
        <stop offset="1" stopColor={HEAD} />
      </linearGradient>
    }>
      <path {...LINE} stroke={`url(#${uid}b)`} strokeWidth={2.75}
            d="M18.25 13.75H28.625a4.125 4.125 0 0 1 0 8.25H15.375a4.125 4.125 0 0 0 0 8.25H23.5" />
      <rect x="22.5" y="27.25" width="6" height="6" rx="2.4" fill={HEAD} />
      <circle cx="32.4" cy="30.25" r="2.2" fill={FOOD} />
    </Tile>
  );
}

// A chat bubble that is the bot: antenna on top, two eyes inside.
export function AssistantLogo({ size = 44 }) {
  const uid = useId();
  return (
    <Tile uid={uid} size={size}>
      <g {...LINE}>
        <path d="M17 16.5H27a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5H17.5L12 34V21.5a5 5 0 0 1 5-5z" />
        <path d="M22 16.5V13.4" />
        <path d="M18.8 22.2v2.6M25.2 22.2v2.6" />
      </g>
      <circle cx="22" cy="11.4" r="2" fill={HEAD} />
    </Tile>
  );
}

// This week's issue coming out of an open envelope.
export function DigestLogo({ size = 44 }) {
  const uid = useId();
  return (
    <Tile uid={uid} size={size}>
      <g {...LINE}>
        <path d="M14.5 23.86V13a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v10.86" />
        <path d="M21.8 15.8125H26" />
        <path d="M11.5 22v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V22" />
        <path d="M11.5 22L22 28.5L32.5 22" />
      </g>
      <circle cx="18.6" cy="15.8125" r="2" fill={HEAD} />
    </Tile>
  );
}

const MARKS = { arcade: ArcadeLogo, "qie-assistant": AssistantLogo, "builder-digest": DigestLogo };

/** The merchant's mark, or the letter avatar for a merchant without one. */
export function MerchantLogo({ id, size = 44, fallback = "", style }) {
  const Mark = MARKS[id];
  if (Mark) return <Mark size={size} />;
  const lg = size === 44;
  const custom = size !== 32 && !lg;
  return (
    <div className={lg ? "fl-avatar fl-avatar--lg" : "fl-avatar"}
         style={{ ...(custom ? { width: size, height: size, borderRadius: size / 4 } : null), ...style }}>
      {fallback}
    </div>
  );
}
