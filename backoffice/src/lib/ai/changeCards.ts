// agent_changes row -> what an approval card shows. Pure, shared by the
// inline cards in the chat and the «Εκκρεμότητες» panel, so both describe
// a proposal identically.
import { pgErrorToGreek } from "@/lib/actions";
import { AGENT_ACTIONS, ALLOWLIST, isWritableTable } from "./allowlist";

export type ChangeStatus = "pending" | "approved" | "rejected" | "conflict" | "failed";
export type ChangeOperation = "insert" | "update" | "delete" | "action";

export interface ChangeCardField {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface ChangeCardConflict {
  field: string;
  before: unknown; // what the proposal was based on
  current: unknown; // what the row holds now
  after: unknown; // what the proposal would write
}

export interface ChangeCard {
  id: string;
  status: ChangeStatus;
  operation: ChangeOperation;
  title: string; // e.g. «Επαφή · Ενημέρωση»
  reason: string | null;
  fields: ChangeCardField[];
  conflict: ChangeCardConflict[];
  untrusted: boolean;
  error: string | null;
  resultHref: string | null;
  createdAt: string;
}

export interface AgentChangeRowLike {
  id: string;
  status: string;
  operation: string;
  table_name: string;
  action?: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  changed_fields?: string[] | null;
  conflict?: unknown;
  untrusted_context?: boolean | null;
  error?: string | null;
  result?: unknown;
  created_at: string;
}

export const OP_LABEL: Record<ChangeOperation, string> = {
  insert: "Νέα εγγραφή",
  update: "Ενημέρωση",
  delete: "Διαγραφή",
  action: "Ενέργεια",
};

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  pending: "Περιμένει έγκριση",
  approved: "Εγκρίθηκε",
  rejected: "Απορρίφθηκε",
  conflict: "Σύγκρουση",
  failed: "Απέτυχε",
};

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function tableLabel(table: string, action?: string | null): string {
  if (action && action in AGENT_ACTIONS) return AGENT_ACTIONS[action as keyof typeof AGENT_ACTIONS].label;
  return isWritableTable(table) ? ALLOWLIST[table].label : table;
}

export function toChangeCard(row: AgentChangeRowLike): ChangeCard {
  const operation = row.operation as ChangeOperation;
  const before = asObject(row.before);
  const after = asObject(row.after);
  const spec = isWritableTable(row.table_name) ? ALLOWLIST[row.table_name] : null;

  let fields: ChangeCardField[];
  if (operation === "delete") {
    fields = Object.keys(before)
      .filter((k) => k !== "id")
      .map((field) => ({ field, before: before[field] }));
  } else if (operation === "insert" || operation === "action") {
    fields = Object.keys(after).map((field) => ({ field, after: after[field] }));
  } else {
    // v2 rows list changed_fields; older rows held full snapshots, so diff
    // them over the editable fields.
    const keys =
      row.changed_fields ??
      [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (k) => spec?.editableFields.includes(k) && before[k] !== after[k],
      );
    fields = keys.map((field) => ({ field, before: before[field], after: after[field] }));
  }

  const conflictObj = asObject(row.conflict);
  const conflict = Object.keys(conflictObj).map((field) => {
    const c = asObject(conflictObj[field]);
    return { field, before: c.before, current: c.current, after: c.after };
  });

  const resultId = asObject(row.result).row_id;
  let resultHref: string | null = null;
  if (row.status === "approved" && typeof resultId === "string") {
    if (row.action === "create_revenue_plan") resultHref = `/projects/revenue-plans/${resultId}`;
    else if (row.table_name === "projects" && operation !== "delete") resultHref = `/projects/${resultId}`;
    else if (row.table_name === "contacts" && operation !== "delete") resultHref = `/contacts/${resultId}`;
  }

  return {
    id: row.id,
    status: row.status as ChangeStatus,
    operation,
    title: `${tableLabel(row.table_name, row.action)} · ${OP_LABEL[operation] ?? row.operation}`,
    reason: row.reason,
    fields,
    conflict,
    untrusted: !!row.untrusted_context,
    error: row.error ? greekError(row.error) : null,
    resultHref,
    createdAt: row.created_at,
  };
}

// apply_agent_change stores "SQLSTATE: message"; show it in Greek.
export function greekError(stored: string): string {
  const m = /^([0-9A-Z]{5}): ([\s\S]*)$/.exec(stored);
  return m ? pgErrorToGreek({ code: m[1], message: m[2] }) : stored;
}

export function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ναι" : "Όχι";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
