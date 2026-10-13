import { normalizeGreek } from "../text";

// Project / category hints for a bank line, beside the transaction matcher
// (score.ts): a payment that quotes a supply / contract account / RF number
// registered for a property (property_utilities, 0027 -- the «Ακίνητα &
// Παροχές» sheet) belongs to that property, and a bank's own fee line to
// «Τραπεζικά». A hint pre-fills project_id / category_id of the staged row;
// the reviewer still sees and can change it. Pure: the caller loads the
// utilities and categories once per batch.

export type UtilityKind = "electricity" | "water" | "internet" | "phone" | "other";

export interface UtilityRef {
  projectId: string;
  projectLabel?: string | null;
  kind: UtilityKind;
  // Identifiers reduced to [0-9A-Z] (the generated column of 0027).
  matchKeys: string[];
}

export interface CategoryRef {
  id: string;
  name: string;
  kind: "income" | "expense" | null;
  keywords?: string[];
}

// Same rule as match_property_utility(): compare on [0-9A-Z] only, so the
// spaces and dashes every bank formats differently do not matter, and
// ignore keys shorter than 8 (they turn up inside unrelated amounts/IBANs).
const MIN_KEY = 8;
export const compactKey = (text: string | null | undefined) => (text ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export function matchUtility(texts: (string | null | undefined)[], utilities: UtilityRef[]): UtilityRef | null {
  const haystack = compactKey(texts.filter(Boolean).join(" "));
  if (haystack.length < MIN_KEY) return null;
  const hits = utilities.filter((u) => u.matchKeys.some((k) => k.length >= MIN_KEY && haystack.includes(k)));
  if (hits.length === 0) return null;
  // Two properties quoted in one line: no guess.
  const projects = new Set(hits.map((h) => h.projectId));
  return projects.size === 1 ? hits[0] : null;
}

// Category-name stems per utility kind (normalised, prefix match on words).
const KIND_WORDS: Record<UtilityKind, string[]> = {
  electricity: ["ΡΕΥΜΑ", "ΗΛΕΚΤΡ", "ΔΕΗ", "ΕΝΕΡΓΕΙΑ"],
  water: ["ΝΕΡΟ", "ΥΔΡΕΥΣ", "ΕΥΔΑΠ", "ΕΥΑΘ", "ΔΕΥΑ"],
  internet: ["INTERNET", "ΔΙΑΔΙΚΤ", "ΤΗΛΕΠΙΚΟΙΝ", "ΤΗΛΕΦΩΝ"],
  phone: ["ΤΗΛΕΦΩΝ", "ΤΗΛΕΠΙΚΟΙΝ", "ΚΙΝΗΤ"],
  other: [],
};
// Any utility, when no kind-specific category exists.
const UTILITY_WORDS = ["ΛΟΓΑΡΙΑΣΜΟΙ ΚΟΙΝΗΣ ΩΦΕΛΕΙΑΣ", "ΔΕΚΟ", "ΠΑΡΟΧ", "ΚΟΙΝΗΣ ΩΦΕΛΕΙΑΣ"];

function scoreCategory(category: CategoryRef, stems: string[]): boolean {
  const words = [normalizeGreek(category.name), ...(category.keywords ?? []).map(normalizeGreek)];
  return stems.some((stem) => words.some((w) => w === stem || w.startsWith(stem) || w.split(/[\s/,-]+/).some((t) => t.startsWith(stem))));
}

// The org's category for a hint: by the hint's own name first («Τραπεζικά»
// -> «Τραπεζικά έξοδα»), else by the utility kind. Expense (or unsigned)
// categories only; null when nothing fits or several fit equally.
export function categoryForHint(
  hint: { name?: string | null; utilityKind?: UtilityKind | null },
  categories: CategoryRef[],
): CategoryRef | null {
  const pool = categories.filter((c) => c.kind !== "income");
  const pick = (stems: string[]) => {
    if (stems.length === 0) return null;
    const hits = pool.filter((c) => scoreCategory(c, stems));
    return hits.length >= 1 ? hits[0] : null;
  };
  if (hint.name) {
    const stem = normalizeGreek(hint.name).slice(0, 6);
    const byName = pick([stem]);
    if (byName) return byName;
  }
  if (hint.utilityKind) return pick(KIND_WORDS[hint.utilityKind]) ?? pick(UTILITY_WORDS);
  return null;
}

export interface RowHint {
  projectId: string | null;
  categoryId: string | null;
  reason: "utility" | "fee" | null;
  projectLabel: string | null;
  categoryName: string | null;
  utilityKind: UtilityKind | null;
}

export function hintForRow(
  row: { description: string | null; reference: string | null; counterpartyName: string | null; categoryHint?: string | null; direction: "income" | "expense" | null },
  utilities: UtilityRef[],
  categories: CategoryRef[],
): RowHint {
  const none: RowHint = { projectId: null, categoryId: null, reason: null, projectLabel: null, categoryName: null, utilityKind: null };
  if (row.direction === "income") return none;
  if (row.categoryHint) {
    const category = categoryForHint({ name: row.categoryHint }, categories);
    return { ...none, reason: "fee", categoryId: category?.id ?? null, categoryName: category?.name ?? row.categoryHint };
  }
  const utility = matchUtility([row.description, row.reference, row.counterpartyName], utilities);
  if (!utility) return none;
  const category = categoryForHint({ utilityKind: utility.kind }, categories);
  return {
    projectId: utility.projectId,
    categoryId: category?.id ?? null,
    reason: "utility",
    projectLabel: utility.projectLabel ?? null,
    categoryName: category?.name ?? null,
    utilityKind: utility.kind,
  };
}
