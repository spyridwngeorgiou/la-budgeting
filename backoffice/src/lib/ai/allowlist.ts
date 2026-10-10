// What the assistant may propose to change, table by table. Pure (no
// server-only import) so the parity test can compare it with the SQL copy
// in agent_change_columns (0083) -- apply_agent_change() enforces the SQL
// copy, propose_change and the review UI use this one, and the two must
// never drift (src/lib/ai/allowlist.test.ts).

export interface TableSpec {
  label: string; // Greek label shown in the diff/search UI
  labelField: string; // column used as the row's display name
  searchFields: string[]; // ilike'd for find_record
  editableFields: string[]; // the only columns propose_change may touch
}

// `satisfies` (not `:`) so the object's literal keys survive for
// `keyof typeof ALLOWLIST` below.
export const ALLOWLIST = {
  accounts: {
    label: "Λογαριασμός",
    labelField: "name",
    searchFields: ["name"],
    editableFields: ["name", "opening_balance", "opening_balance_date", "iban", "notes", "is_active"],
  },
  projects: {
    label: "Έργο",
    labelField: "display_name",
    searchFields: ["display_name", "code"],
    editableFields: [
      "display_name", "status", "phase", "units", "collateral_value",
      "start_date", "construction_end_date", "opening_date", "rent_start_date",
    ],
  },
  contacts: {
    label: "Επαφή",
    labelField: "name",
    searchFields: ["name", "afm"],
    editableFields: [
      "name", "afm", "kind", "phone", "email", "iban", "address",
      "default_vat_rate", "default_withholding_rate", "payment_terms_days", "notes", "is_active",
    ],
  },
  installment_plans: {
    label: "Πλάνο Δόσεων",
    labelField: "label",
    searchFields: ["label"],
    editableFields: [
      "label", "amount_per_installment", "vat_rate", "withholding_per_installment",
      "escalation_pct", "frequency", "first_due_date", "installment_count", "end_date", "status", "notes",
    ],
  },
  project_notes: {
    label: "Σημείωση Έργου",
    labelField: "body",
    searchFields: ["body"],
    // project_id is required (not null, no default) -- must be settable on
    // insert. kind is status|risk only since 0041; to-dos are tasks below.
    editableFields: ["project_id", "kind", "severity", "body", "exposure_amount", "due_date", "resolved_at"],
  },
  // Planner (0040): org_id on insert is overwritten from project_id by
  // planner_guard. assignee_id is left out: the model has no reliable way to
  // know user ids.
  tasks: {
    label: "Εργασία",
    labelField: "title",
    searchFields: ["title", "description"],
    editableFields: ["project_id", "title", "description", "status", "priority", "start_date", "due_date"],
  },
  project_milestones: {
    label: "Ορόσημο Έργου",
    labelField: "title",
    searchFields: ["title", "description"],
    editableFields: ["project_id", "title", "description", "kind", "due_date", "done_at"],
  },
  loans: {
    label: "Δάνειο",
    labelField: "label",
    searchFields: ["label"],
    editableFields: [
      "project_id", "label", "principal", "interest_rate", "term_years",
      "grace_years", "first_amortisation_month", "state", "notes",
    ],
  },
} satisfies Record<string, TableSpec>;

export type WritableTable = keyof typeof ALLOWLIST;

export const WRITABLE_TABLES = Object.keys(ALLOWLIST) as [WritableTable, ...WritableTable[]];

export function isWritableTable(name: string): name is WritableTable {
  return Object.prototype.hasOwnProperty.call(ALLOWLIST, name);
}

// Multi-step actions the assistant may propose (agent_changes.action). Each
// is executed by apply_agent_change() in SQL after a human approves.
export const AGENT_ACTIONS = {
  create_revenue_plan: { label: "Νέα εκτίμηση εσόδων" },
} as const;

export type AgentAction = keyof typeof AGENT_ACTIONS;
