// Stroke icons on a 20px grid, matching the artboards. Inline so they recolor
// with currentColor and stay crisp at any size.
const S = ({ children, size = 18, stroke = "currentColor", width = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={stroke}
       strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export const IconGrid = (p) => <S {...p}><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></S>;
export const IconRepeat = (p) => <S {...p}><path d="M4 8V6.5A2.5 2.5 0 016.5 4H14l-2-2m4 6v1.5a2.5 2.5 0 01-2.5 2.5H6l2 2" /></S>;
export const IconStore = (p) => <S {...p}><path d="M3 8h14v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8zM3 8l1.5-4h11L17 8" /></S>;
export const IconShield = (p) => <S {...p}><path d="M10 3l6 2.5V10c0 3.5-2.5 6-6 7-3.5-1-6-3.5-6-7V5.5L10 3z" /></S>;
export const IconPulse = (p) => <S {...p}><path d="M2 10h3.5l2-5 3 10 2.5-5H18" /></S>;
export const IconSwap = (p) => <S {...p}><path d="M4 7h11l-3-3m3 9H4l3 3" /></S>;
export const IconCheck = (p) => <S width={2} {...p}><path d="M4 10l4 4 8-9" /></S>;
export const IconPlus = (p) => <S width={1.9} {...p}><path d="M10 4v12M4 10h12" /></S>;
export const IconChevronLeft = (p) => <S width={1.7} {...p}><path d="M12 5l-5 5 5 5" /></S>;
export const IconChevronDown = (p) => <S width={1.7} {...p}><path d="M5 8l5 5 5-5" /></S>;
export const IconCopy = (p) => <S width={1.6} {...p}><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 5H5a1 1 0 00-1 1v8" /></S>;
export const IconDots = (p) => <S width={1.6} {...p}><circle cx="10" cy="4.5" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="10" cy="15.5" r="1.2" /></S>;
export const IconMenu = (p) => <S width={1.8} {...p}><path d="M3 6h14M3 10h14M3 14h14" /></S>;
export const IconMark = (p) => <S width={1.6} {...p}><path d="M3 14c3.5 0 3.5-8 7-8s3.5 8 7 8" /></S>;
