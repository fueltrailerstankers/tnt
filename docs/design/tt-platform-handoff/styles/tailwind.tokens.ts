// Merge into tailwind.config.ts → theme.extend. All values read the CSS variables in tokens.css,
// so light/dark switch by toggling data-theme on <html>.
export const ttTheme = {
  colors: {
    bg: "var(--bg)",
    surface: { DEFAULT: "var(--surface)", 2: "var(--surface2)" },
    border: { DEFAULT: "var(--border)", strong: "var(--strong)" },
    fg: { DEFAULT: "var(--text)", muted: "var(--muted)", subtle: "var(--subtle)" },
    accent: { DEFAULT: "var(--accent)", fg: "var(--onaccent)", soft: "var(--accentsoft)", text: "var(--accenttext)" },
    side: { DEFAULT: "var(--side)", border: "var(--sideborder)", fg: "var(--sidetext)", muted: "var(--sidemuted)", active: "var(--sideactive)" },
    status: {
      gray: { bg: "var(--grayb)", fg: "var(--grayt)" },
      teal: { bg: "var(--tealb)", fg: "var(--tealt)" },
      yellow: { bg: "var(--yelb)", fg: "var(--yelt)" },
      green: { bg: "var(--grnb)", fg: "var(--grnt)" },
      red: { bg: "var(--redb)", fg: "var(--redt)" },
    },
    danger: "var(--red)",
  },
  borderRadius: { xs: "6px", sm: "10px", md: "12px", lg: "16px", pill: "999px" },
  boxShadow: { card: "var(--cardshadow)", overlay: "var(--shadow)" },
  fontFamily: {
    sans: ["Manrope", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
    mono: ["JetBrains Mono", "ui-monospace", "monospace"],
  },
  fontSize: {
    display: ["28px", { lineHeight: "34px", letterSpacing: "-0.02em", fontWeight: "700" }],
    h1: ["24px", { lineHeight: "30px", letterSpacing: "-0.02em", fontWeight: "700" }],
    h2: ["17px", { lineHeight: "24px", fontWeight: "600" }],
    body: ["14px", { lineHeight: "20px" }],
    small: ["13px", { lineHeight: "18px" }],
    label: ["12px", { lineHeight: "16px", letterSpacing: "0.06em", fontWeight: "600" }],
  },
};

// Status → tone map used by <StatusChip>. Keep labels exactly as written (users know them from Cognito).
export const STATUS_TONE: Record<string, keyof typeof ttTheme.colors.status> = {
  Incomplete: "gray", Archived: "gray", "Submitted (archived)": "gray", Draft: "gray", Lost: "gray",
  Submitted: "teal", New: "teal", Invoiced: "teal",
  Reviewed: "yellow", Sent: "yellow", Authorised: "yellow", "Dry-run": "yellow", Contacted: "yellow",
  Approved: "green", Accepted: "green", Paid: "green", "APPROVED EMAILED": "green", Won: "green",
  APPROVAL: "red", Failed: "red", Overdue: "red", Declined: "red", "Changes requested": "red",
};
