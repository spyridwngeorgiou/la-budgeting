import "server-only";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// Seven curated, read-only, parameterized tools -- deliberately NOT a
// model-written-SQL tool. Greek VAT/withholding logic belongs in one tested
// place (the SQL views), and every tool here executes through the caller's
// RLS-scoped client, so authorization is a database property, not a prompt
// instruction. Every list/aggregate result carries transaction ids so the
// chat UI can render a "δείτε τις κινήσεις" drill-down link that is
// guaranteed to match the number in the reply -- the number IS the ids.

const DIRECTION = z.enum(["income", "expense"]).optional().describe("Παράλειψη = και τα δύο");
const SCOPE = z.enum(["business", "personal"]).optional().describe("Παράλειψη = και τα δύο");

export function buildAssistantTools(supabase: SupabaseClient) {
  // Populated as a side effect of each tool call (never read by the model
  // itself) so the route handler can build one "δείτε τις κινήσεις"
  // drill-down link covering every transaction referenced anywhere in the
  // turn, after the tool loop finishes.
  const collectedIds = new Set<string>();
  const collect = (ids: string[]) => ids.forEach((id) => collectedIds.add(id));

  const find_entities = betaZodTool({
    name: "find_entities",
    description:
      "Αναζήτηση επαφών, έργων, κατηγοριών ή λογαριασμών με βάση ελεύθερο κείμενο (π.χ. 'Ηλιούπολη', 'Παπαδόπουλος'). Χρησιμοποιήστε το πρώτα όταν δεν είστε σίγουροι ποιο έργο/επαφή εννοεί ο χρήστης, ή όταν υπάρχει πιθανότητα διπλής σημασίας.",
    inputSchema: z.object({ query: z.string().min(1) }),
    run: async ({ query }) => {
      const like = `%${query}%`;
      const [contacts, projects, categories, accounts] = await Promise.all([
        supabase.from("contacts").select("id, name, afm").ilike("name", like).limit(10),
        supabase.from("projects").select("id, display_name, code").ilike("display_name", like).limit(10),
        supabase.from("categories").select("id, name").ilike("name", like).limit(10),
        supabase.from("accounts").select("id, name").ilike("name", like).limit(10),
      ]);
      return JSON.stringify({
        contacts: contacts.data ?? [],
        projects: projects.data ?? [],
        categories: categories.data ?? [],
        accounts: accounts.data ?? [],
      });
    },
  });

  const list_transactions = betaZodTool({
    name: "list_transactions",
    description:
      "Λίστα κινήσεων με φίλτρα. Επιστρέφει τις ίδιες κινήσεις (με ids) που θα έβλεπε ο χρήστης στη σελίδα Κινήσεις. Χρησιμοποιήστε aggregate_transactions αντ' αυτού όταν χρειάζεστε σύνολα ανά κατηγορία/έργο/μήνα.",
    inputSchema: z.object({
      from: z.string().optional().describe("ISO ημερομηνία, π.χ. 2026-08-01"),
      to: z.string().optional(),
      direction: DIRECTION,
      scope: SCOPE,
      status: z.enum(["paid", "pending", "scheduled", "cancelled"]).optional(),
      project_id: z.string().optional(),
      contact_id: z.string().optional(),
      category_id: z.string().optional(),
      account_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    run: async (args) => {
      let q = supabase
        .from("transactions")
        .select(
          "id, tx_date, description, direction, status, gross_amount, contacts(name), projects(display_name), categories(name)",
        )
        .order("tx_date", { ascending: false })
        .limit(args.limit);
      if (args.from) q = q.gte("tx_date", args.from);
      if (args.to) q = q.lte("tx_date", args.to);
      if (args.direction) q = q.eq("direction", args.direction);
      if (args.scope) q = q.eq("scope", args.scope);
      if (args.status) q = q.eq("status", args.status);
      if (args.project_id) q = q.eq("project_id", args.project_id);
      if (args.contact_id) q = q.eq("contact_id", args.contact_id);
      if (args.category_id) q = q.eq("category_id", args.category_id);
      if (args.account_id) q = q.eq("account_id", args.account_id);
      const { data, error } = await q;
      if (error) return JSON.stringify({ error: error.message });
      const rows = (data ?? []).map((tx) => {
        const contact = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
        const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
        const category = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
        return {
          id: tx.id,
          date: tx.tx_date,
          description: tx.description,
          direction: tx.direction,
          status: tx.status,
          amount: tx.gross_amount,
          contact: contact?.name ?? null,
          project: project?.display_name ?? null,
          category: category?.name ?? null,
        };
      });
      collect(rows.map((r) => r.id));
      return JSON.stringify({ transaction_ids: rows.map((r) => r.id), rows });
    },
  });

  const aggregate_transactions = betaZodTool({
    name: "aggregate_transactions",
    description:
      "Σύνολα κινήσεων ομαδοποιημένα ανά έργο, κατηγορία, επαφή, λογαριασμό ή μήνα, με τα ids των κινήσεων που τα απαρτίζουν. Χρησιμοποιήστε το για ερωτήσεις τύπου 'πόσα ξοδέψαμε στο X', 'ποιος μας χρωστάει', 'ανά κατηγορία'.",
    inputSchema: z.object({
      group_by: z.enum(["project", "category", "contact", "account", "month"]),
      from: z.string().optional(),
      to: z.string().optional(),
      direction: DIRECTION,
      scope: SCOPE,
      status: z.enum(["paid", "pending", "scheduled", "cancelled"]).optional(),
    }),
    run: async (args) => {
      let q = supabase
        .from("transactions")
        .select(
          "id, tx_date, gross_amount, direction, project_id, projects(display_name), category_id, categories(name), contact_id, contacts(name), account_id, accounts(name)",
        )
        .neq("status", "cancelled");
      if (args.from) q = q.gte("tx_date", args.from);
      if (args.to) q = q.lte("tx_date", args.to);
      if (args.direction) q = q.eq("direction", args.direction);
      if (args.scope) q = q.eq("scope", args.scope);
      if (args.status) q = q.eq("status", args.status);
      const { data, error } = await q;
      if (error) return JSON.stringify({ error: error.message });

      const groups = new Map<string, { label: string; total: number; ids: string[] }>();
      for (const tx of data ?? []) {
        let key: string;
        let label: string;
        if (args.group_by === "month") {
          key = tx.tx_date.slice(0, 7);
          label = key;
        } else if (args.group_by === "project") {
          const p = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
          key = tx.project_id ?? "none";
          label = p?.display_name ?? "Χωρίς έργο";
        } else if (args.group_by === "category") {
          const c = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
          key = tx.category_id ?? "none";
          label = c?.name ?? "Χωρίς κατηγορία";
        } else if (args.group_by === "contact") {
          const c = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
          key = tx.contact_id ?? "none";
          label = c?.name ?? "Χωρίς επαφή";
        } else {
          const a = Array.isArray(tx.accounts) ? tx.accounts[0] : tx.accounts;
          key = tx.account_id ?? "none";
          label = a?.name ?? "Χωρίς λογαριασμό";
        }
        const g = groups.get(key) ?? { label, total: 0, ids: [] };
        g.total += Number(tx.gross_amount ?? 0);
        g.ids.push(tx.id);
        groups.set(key, g);
      }
      const result = [...groups.values()]
        .sort((a, b) => b.total - a.total)
        .map((g) => ({ label: g.label, total: Math.round(g.total * 100) / 100, transaction_ids: g.ids }));
      collect(result.flatMap((g) => g.transaction_ids));
      return JSON.stringify({ groups: result });
    },
  });

  const vat_position = betaZodTool({
    name: "vat_position",
    description:
      "Θέση ΦΠΑ (ΦΠΑ εκροών/εισροών, πιστωτικό, πληρωτέο) για συγκεκριμένο μήνα ή για τον πιο πρόσφατο μήνα με δεδομένα αν δεν δοθεί ημερομηνία. Υπολογίζεται σε δεδουλευμένη βάση (ημερομηνία τιμολογίου) με μεταφορά πιστωτικού.",
    inputSchema: z.object({
      period: z.string().optional().describe("Μήνας σε μορφή YYYY-MM. Παράλειψη = πιο πρόσφατος μήνας με δεδομένα."),
    }),
    run: async ({ period }) => {
      let q = supabase.from("v_vat_position").select("*").order("period_start", { ascending: false });
      if (period) q = q.eq("period_start", `${period}-01`);
      const { data, error } = await q.limit(1);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data?.[0] ?? { message: "Δεν βρέθηκαν δεδομένα ΦΠΑ." });
    },
  });

  const project_pnl = betaZodTool({
    name: "project_pnl",
    description:
      "Οικονομική εικόνα ενός έργου: προϋπολογισμός, δαπανηθέντα, εκκρεμή, έσοδα. Χρησιμοποιήστε find_entities πρώτα αν δεν είστε σίγουροι για το project_id.",
    inputSchema: z.object({ project_id: z.string() }),
    run: async ({ project_id }) => {
      const { data, error } = await supabase
        .from("v_project_rollup")
        .select("*")
        .eq("project_id", project_id)
        .maybeSingle();
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data ?? { message: "Δεν βρέθηκε το έργο." });
    },
  });

  const outstanding = betaZodTool({
    name: "outstanding",
    description:
      "Τι χρωστάμε (payable, έξοδα σε εκκρεμότητα) ή τι μας χρωστάνε (receivable, έσοδα σε εκκρεμότητα), προαιρετικά μέσα σε συγκεκριμένο ορίζοντα ημερών από σήμερα.",
    inputSchema: z.object({
      direction_owed: z.enum(["payable", "receivable"]),
      horizon_days: z.number().int().positive().optional(),
    }),
    run: async ({ direction_owed, horizon_days }) => {
      const txDirection = direction_owed === "payable" ? "expense" : "income";
      let q = supabase
        .from("transactions")
        .select("id, tx_date, due_date, description, gross_amount, contacts(name), projects(display_name)")
        .eq("direction", txDirection)
        .in("status", ["pending", "scheduled"])
        .order("due_date", { ascending: true, nullsFirst: false });
      if (horizon_days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + horizon_days);
        q = q.lte("due_date", cutoff.toISOString().slice(0, 10));
      }
      const { data, error } = await q.limit(100);
      if (error) return JSON.stringify({ error: error.message });
      const rows = (data ?? []).map((tx) => {
        const contact = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
        const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
        return {
          id: tx.id,
          due_date: tx.due_date,
          description: tx.description,
          amount: tx.gross_amount,
          contact: contact?.name ?? null,
          project: project?.display_name ?? null,
        };
      });
      const total = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
      collect(rows.map((r) => r.id));
      return JSON.stringify({ total: Math.round(total * 100) / 100, transaction_ids: rows.map((r) => r.id), rows });
    },
  });

  const cashflow_forecast = betaZodTool({
    name: "cashflow_forecast",
    description: "Μηνιαία πρόβλεψη ταμείου (εισροές/εκροές πληρωμένων κινήσεων) για τους επόμενους μήνες.",
    inputSchema: z.object({ months_ahead: z.number().int().min(1).max(24).default(6) }),
    run: async ({ months_ahead }) => {
      const from = new Date().toISOString().slice(0, 8) + "01";
      const { data, error } = await supabase
        .from("v_cashflow_monthly")
        .select("*")
        .gte("month", from)
        .order("month")
        .limit(months_ahead * 3); // *3: one row per owner_scope per month
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({ months: data ?? [] });
    },
  });

  return {
    tools: [
      find_entities,
      list_transactions,
      aggregate_transactions,
      vat_position,
      project_pnl,
      outstanding,
      cashflow_forecast,
    ],
    collectedIds,
  };
}
