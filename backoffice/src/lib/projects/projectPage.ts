// Which blocks of the project page (projects/[id]/LegacyProjectPage.tsx)
// are on the page, and what its closing «Προσθήκη:» line offers.
//
// A block with nothing in it is not rendered. What it would have let you
// add moves to one line at the end -- «Προσθήκη: + Δάνειο · + Σύμβαση
// πελάτη · + Παροχή · + Σενάριο λειτουργίας · + Σημείωση» -- with only what
// is missing, in that order. A block that is on the page carries its own
// add button (OnePagerSection `actions`), so nothing is offered twice.
// Pure: the page passes what it already read.

export type ProjectAddition = "loan" | "contract" | "utility" | "scenario" | "note";

export const ADDITION_ORDER: readonly ProjectAddition[] = ["loan", "contract", "utility", "scenario", "note"];

export interface ProjectPageFacts {
  businessModel: string | null;
  hasBudget: boolean;
  // Anything ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ shows besides the budget: capex paid or
  // committed, occupancy, other opex, unclassified spend (v_project_rollup).
  hasSpend: boolean;
  // ΑΝΑΠΤΥΞΗ has flows to show (development revenue or cost not zero).
  developmentFlows: boolean;
  contractValue: number | null;
  revenueToDate: number;
  irr: number | null;
  loans: number;
  hasScenario: boolean;
  // Revenue plans linked to this project.
  revenuePlans: number;
  hasCashflow: boolean;
  utilities: number;
  // Rent plus settlement instalments, per month.
  occupancyPerMonth: number;
  // Months with property costs in the last 12.
  costMonths: number;
  openNotes: number;
}

export interface ProjectBlocks {
  budget: boolean;
  development: boolean;
  revenue: boolean;
  // ΕΣΟΔΑ shows the IRR (ΑΝΑΠΤΥΞΗ does when it is on the page).
  revenueIrr: boolean;
  loan: boolean;
  operation: boolean;
  cashflow: boolean;
  property: boolean;
  status: boolean;
  additions: ProjectAddition[];
}

// A client contract belongs to client work: not offered for a development
// for sale or a hotel lease (it stays editable in «Επεξεργασία έργου»).
const NO_CONTRACT = new Set(["own_development", "hotel_lease"]);

export function projectBlocks(f: ProjectPageFacts): ProjectBlocks {
  const development = f.businessModel === "own_development" && f.developmentFlows;
  const revenueIrr = !development && f.irr != null && Number.isFinite(f.irr);
  const revenue = f.contractValue != null || f.revenueToDate !== 0 || revenueIrr;
  const loan = f.loans > 0;
  const operation = f.hasScenario || f.revenuePlans > 0;
  const property = f.utilities > 0 || f.occupancyPerMonth > 0 || f.costMonths > 0;
  const status = f.openNotes > 0;

  const missing: Record<ProjectAddition, boolean> = {
    loan: !loan,
    contract: f.contractValue == null && !NO_CONTRACT.has(f.businessModel ?? ""),
    utility: !property,
    scenario: !operation,
    note: !status,
  };
  return {
    budget: f.hasBudget || f.hasSpend,
    development,
    revenue,
    revenueIrr,
    loan,
    operation,
    cashflow: f.hasCashflow,
    property,
    status,
    additions: ADDITION_ORDER.filter((a) => missing[a]),
  };
}

// ΚΑΤΑΣΤΑΣΗ: urgent and watch notes in view (urgent first, otherwise in
// their own order); the information notes behind «▸ Λοιπές (N)».
export function splitNotes<T extends { severity: string }>(notes: readonly T[]): { pressing: T[]; rest: T[] } {
  const rank = (n: T) => (n.severity === "urgent" ? 0 : 1);
  const pressing = notes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.severity === "urgent" || n.severity === "watch")
    .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
    .map(({ n }) => n);
  return { pressing, rest: notes.filter((n) => n.severity !== "urgent" && n.severity !== "watch") };
}
