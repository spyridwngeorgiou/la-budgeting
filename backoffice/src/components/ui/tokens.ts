// The design tokens as plain values, for the places CSS variables cannot
// reach: SVG attributes in charts (recharts takes hex strings), the /design
// page's live contrast ratios and tokens.test.ts. src/app/globals.css holds
// the same values as Tailwind @theme variables; tokens.test.ts fails if the
// two drift apart.
//
// Source: the P15 Residences «Light Blue» theme (la_proposals/template/
// themes/light-blue.json), plus the app-only tokens the plan adds
// (field-border, accent-ink, semantic colours).

export const color = {
  // Surfaces
  canvas: "#eef2f5",
  raised: "#f7f9fb",
  field: "#ffffff",
  hover: "#e6ecf1",
  frame: "#dfe6ec",
  // Text
  ink: "#1c2b3a",
  text: "#34465a",
  muted: "#566a7e",
  // Lines
  hairline: "#c9d4de",
  chipBorder: "#9fb2c4",
  fieldBorder: "#6e8196",
  rule: "#274c6e",
  // Brand
  navy: "#274c6e",
  navyStrong: "#1f3d59",
  accent: "#6d8aa6",
  accentInk: "#4f6d8a",
  // The navy panel («Με μια ματιά», toast)
  panel: "#274c6e",
  panelInk: "#f2f5f8",
  panelMuted: "#c6d3df",
  panelHairline: "rgba(242,245,248,0.24)",
  // Semantic -- colour only for exceptions; each with a light tint
  positive: "#2f6650",
  positiveTint: "#e3eee8",
  negative: "#9b3a32",
  negativeTint: "#f6e5e3",
  warning: "#7a5a16",
  warningTint: "#f5ecd9",
  ai: "#55508a",
  aiTint: "#ebeaf3",
  aiBorder: "#c9c6dd",
} as const;

export type ColorToken = keyof typeof color;

// kebab-case CSS name of a token: chipBorder -> chip-border.
export const cssName = (token: ColorToken) => token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Type scale: [size px, line-height, weight]. Headings are 400, large
// figures Light 300 with tabular numerals, eyebrows 12/500 uppercase.
export const type = {
  display: [40, 1.15, 400],
  figure: [36, 1.1, 300],
  "figure-sm": [24, 1.2, 300],
  numeral: [28, 1, 300],
  title: [30, 1.2, 400],
  section: [20, 1.3, 400],
  lead: [17, 1.5, 400],
  body: [15, 1.5, 400],
  small: [13, 1.45, 400],
  eyebrow: [12, 1.3, 500],
} as const satisfies Record<string, readonly [number, number, number]>;

// Pairs that must pass WCAG: 4.5 for text, 3 for large text (≥24px) and UI
// boundaries (field borders, focus outline). Checked in tokens.test.ts and
// shown live on /design.
export const CONTRAST_PAIRS: { fg: ColorToken; bg: ColorToken; min: 3 | 4.5; use: string }[] = [
  { fg: "ink", bg: "canvas", min: 4.5, use: "κείμενο" },
  { fg: "text", bg: "canvas", min: 4.5, use: "κείμενο" },
  { fg: "muted", bg: "canvas", min: 4.5, use: "δευτερεύον κείμενο" },
  { fg: "muted", bg: "raised", min: 4.5, use: "δευτερεύον κείμενο" },
  { fg: "muted", bg: "hover", min: 4.5, use: "δευτερεύον σε hover" },
  { fg: "ink", bg: "field", min: 4.5, use: "πεδία" },
  { fg: "accentInk", bg: "canvas", min: 4.5, use: "σύνδεσμοι, αριθμοί ενοτήτων" },
  { fg: "accent", bg: "canvas", min: 3, use: "γραφικά, νούμερα ≥24px" },
  { fg: "fieldBorder", bg: "field", min: 3, use: "περίγραμμα πεδίου" },
  { fg: "fieldBorder", bg: "canvas", min: 3, use: "περίγραμμα πεδίου" },
  { fg: "navy", bg: "canvas", min: 4.5, use: "εστίαση, ενεργό" },
  { fg: "panelInk", bg: "panel", min: 4.5, use: "κείμενο σε πάνελ / κουμπί" },
  { fg: "panelMuted", bg: "panel", min: 4.5, use: "δευτερεύον σε πάνελ" },
  { fg: "panelInk", bg: "navyStrong", min: 4.5, use: "κουμπί hover" },
  { fg: "positive", bg: "canvas", min: 4.5, use: "θετικό" },
  { fg: "positive", bg: "positiveTint", min: 4.5, use: "θετικό σήμα" },
  { fg: "negative", bg: "canvas", min: 4.5, use: "αρνητικό" },
  { fg: "negative", bg: "negativeTint", min: 4.5, use: "αρνητικό σήμα" },
  { fg: "warning", bg: "canvas", min: 4.5, use: "προσοχή" },
  { fg: "warning", bg: "warningTint", min: 4.5, use: "σήμα προσοχής" },
  { fg: "ai", bg: "canvas", min: 4.5, use: "AI" },
  { fg: "ai", bg: "aiTint", min: 4.5, use: "σήμα AI" },
];

// WCAG 2.x relative luminance / contrast ratio, for #rrggbb.
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Chart series order: navy first, then the accent, then muted text.
export const chartSeries = [color.navy, color.accent, color.muted, color.chipBorder] as const;
