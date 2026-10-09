// Small pure text helpers for the collaboration space (no React, no
// Supabase), shared by the canvas, the chat and the project page.

// Fills "{name}" placeholders in an el.ts string. Unknown keys stay as-is so
// a typo shows up on screen instead of silently vanishing.
export function fillText(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

// Accent- and case-insensitive form for matching Greek names and commands:
// "Βοηθός", "βοηθος" and "ΒΟΗΘΟΣ" all fold to "βοηθος"; final sigma folds too.
export function foldGreek(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("el-GR")
    .replace(/ς/g, "σ");
}

// "Κάτοψη ισογείου v3.pdf" -> "Κάτοψη ισογείου v3"
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
