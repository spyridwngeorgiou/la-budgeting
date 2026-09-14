import "server-only";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// Kansha Operator's write path: the model NEVER writes to a real table. It
// calls propose_change, which validates the table/fields against this
// allowlist, snapshots the current row, and inserts a row into
// agent_changes with status='pending' -- a human reviews the before/after
// diff at /changes and approves or rejects it. Same guarantee as
// transaction_drafts (0010_ai_documents.sql), generalised to master data.

interface TableSpec {
  label: string; // Greek label shown in the diff/search UI
  labelField: string; // column used as the row's display name
  searchFields: string[]; // ilike'd for find_record
  editableFields: string[]; // the only columns propose_change may touch
}

// `satisfies` (not `:`) so the object's literal keys survive for
// `keyof typeof ALLOWLIST` below -- an explicit Record<string, TableSpec>
// annotation would widen every key to `string`.
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
} satisfies Record<string, TableSpec>;

export type WritableTable = keyof typeof ALLOWLIST;

const TABLE_ENUM = z.enum(Object.keys(ALLOWLIST) as [WritableTable, ...WritableTable[]]);

export function buildWriteTools(supabase: SupabaseClient, orgId: string, userId: string | null) {
  const collectedChangeIds = new Set<string>();

  const find_record = betaZodTool({
    name: "find_record",
    description:
      "Αναζήτηση μιας συγκεκριμένης εγγραφής (λογαριασμός, έργο, επαφή, πλάνο δόσεων) πριν προτείνετε αλλαγή/διαγραφή -- πάντα καλέστε αυτό πρώτα για να βρείτε το σωστό row_id, ποτέ μην μαντεύετε ή χρησιμοποιείτε id από παλιότερη απάντηση χωρίς επιβεβαίωση.",
    inputSchema: z.object({
      table: TABLE_ENUM.describe("accounts (λογαριασμοί/ταμεία), projects (έργα), contacts (επαφές), installment_plans (δόσεις)"),
      query: z.string().min(1),
    }),
    run: async ({ table, query }) => {
      const spec = ALLOWLIST[table];
      const like = `%${query}%`;
      const orFilter = spec.searchFields.map((f) => `${f}.ilike.${like}`).join(",");
      const { data, error } = await supabase.from(table).select("*").or(orFilter).limit(10);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        table,
        matches: (data ?? []).map((row) => ({ id: row.id, label: row[spec.labelField], row })),
      });
    },
  });

  const propose_change = betaZodTool({
    name: "propose_change",
    description:
      "Προτείνει μια αλλαγή (ενημέρωση, διαγραφή, ή νέα εγγραφή) σε λογαριασμό/έργο/επαφή/πλάνο δόσεων. ΔΕΝ εφαρμόζει την αλλαγή -- δημιουργεί μια πρόταση προς έγκριση από άνθρωπο. Για update/delete χρειάζεται πραγματικό row_id (από find_record). Πάντα δώστε σύντομη αιτιολογία (reason) στα Ελληνικά.",
    inputSchema: z.object({
      table: TABLE_ENUM,
      operation: z.enum(["insert", "update", "delete"]),
      row_id: z.string().nullable().describe("Απαιτείται για update/delete, null για insert"),
      changes: z
        .array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }))
        .describe("Τα πεδία προς αλλαγή (update/insert). Κενό πίνακα για delete."),
      reason: z.string().min(1).describe("Σύντομη εξήγηση γιατί προτείνεται αυτή η αλλαγή, στα Ελληνικά"),
    }),
    run: async ({ table, operation, row_id, changes, reason }) => {
      const spec = ALLOWLIST[table];
      const filtered = Object.fromEntries(
        changes.filter((c) => spec.editableFields.includes(c.field)).map((c) => [c.field, c.value]),
      );

      if (operation === "insert") {
        if (!filtered[spec.labelField]) {
          return JSON.stringify({ error: `Λείπει το πεδίο ${spec.labelField}, απαραίτητο για νέα εγγραφή.` });
        }
        const { data, error } = await supabase
          .from("agent_changes")
          .insert({
            org_id: orgId,
            table_name: table,
            row_id: null,
            operation: "insert",
            before: null,
            after: filtered,
            reason,
            requested_by: userId,
          })
          .select("id")
          .single();
        if (error) return JSON.stringify({ error: error.message });
        collectedChangeIds.add(data.id);
        return JSON.stringify({ change_id: data.id, status: "pending", message: "Η πρόταση καταχωρήθηκε, περιμένει έγκριση." });
      }

      if (!row_id) return JSON.stringify({ error: "Λείπει row_id για update/delete." });
      const { data: before, error: fetchError } = await supabase.from(table).select("*").eq("id", row_id).maybeSingle();
      if (fetchError) return JSON.stringify({ error: fetchError.message });
      if (!before) return JSON.stringify({ error: "Δεν βρέθηκε η εγγραφή -- καλέστε find_record ξανά." });

      const after = operation === "delete" ? before : { ...before, ...filtered };
      if (operation === "update" && Object.keys(filtered).length === 0) {
        return JSON.stringify({ error: "Δεν δόθηκε κανένα έγκυρο πεδίο προς αλλαγή." });
      }

      const { data, error } = await supabase
        .from("agent_changes")
        .insert({
          org_id: orgId,
          table_name: table,
          row_id,
          operation,
          before,
          after,
          reason,
          requested_by: userId,
        })
        .select("id")
        .single();
      if (error) return JSON.stringify({ error: error.message });
      collectedChangeIds.add(data.id);
      return JSON.stringify({ change_id: data.id, status: "pending", message: "Η πρόταση καταχωρήθηκε, περιμένει έγκριση." });
    },
  });

  return { tools: [find_record, propose_change], collectedChangeIds };
}
