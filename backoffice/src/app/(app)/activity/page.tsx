import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { Card } from "@/components/ui";

// Ιστορικό -- who signed in, and who added, changed or removed what, newest
// first, one line per event. Filters: person and project (query string).

const ENTITY: Record<string, string> = {
  transactions: "κίνηση", accounts: "λογαριασμό", contacts: "επαφή", projects: "έργο", categories: "κατηγορία",
  installment_plans: "πλάνο δόσεων", project_files: "αρχείο", project_notes: "σημείωση", project_budgets: "budget",
  assets: "περιουσιακό στοιχείο", liabilities: "οφειλή", expected_income: "αναμενόμενο έσοδο", loans: "δάνειο",
  org_members: "μέλος ομάδας",
};
const ACTION: Record<string, string> = { insert: "Νέο", update: "Αλλαγή", delete: "Διαγραφή" };
const FIELD: Record<string, string> = {
  gross_amount: "ποσό", net_amount: "καθαρό", vat_amount: "ΦΠΑ", status: "κατάσταση", tx_date: "ημερομηνία",
  paid_on: "πληρώθηκε", due_date: "λήξη", account_id: "λογαριασμός", project_id: "έργο", category_id: "κατηγορία",
  description: "περιγραφή", opening_balance: "υπόλοιπο έναρξης", notes: "σημειώσεις", role: "ρόλος",
};
const STATUS: Record<string, string> = { paid: "πληρωμένο", pending: "εκκρεμεί", scheduled: "προγραμματισμένο", cancelled: "ακυρωμένο" };

type Event = { at: string; who: string; via: string; text: string; projectId: string | null };

const nameOf = (email: string | null) => (email ? email.split("@")[0] : "Σύστημα");

function show(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (field.endsWith("amount") || field === "opening_balance") return formatMoney(Number(v));
  if (field === "status") return STATUS[String(v)] ?? String(v);
  if (field.endsWith("_id")) return "άλλο";
  return String(v).slice(0, 40);
}

function describe(r: { action: string; entity: string; label: string | null; changes: unknown }): string {
  const what = `${ACTION[r.action] ?? r.action} ${ENTITY[r.entity] ?? r.entity}`;
  const label = r.label ? ` · ${r.label.slice(0, 60)}` : "";
  if (r.action !== "update" || !r.changes) return what + label;
  const diffs = Object.entries(r.changes as Record<string, [unknown, unknown]>)
    .filter(([k]) => k in FIELD)
    .slice(0, 3)
    .map(([k, [a, b]]) => `${FIELD[k]}: ${show(k, a)} → ${show(k, b)}`);
  return what + label + (diffs.length ? ` · ${diffs.join(", ")}` : "");
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ who?: string; project?: string }> }) {
  const { who, project } = await searchParams;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  let q = supabase.from("activity_log").select("at, actor_email, via, action, entity, label, changes, project_id").order("at", { ascending: false }).limit(300);
  if (project) q = q.eq("project_id", project);
  const [{ data: rows, error }, { data: logins }, { data: projects }] = await Promise.all([
    q,
    project ? Promise.resolve({ data: [] as { at: string; email: string }[] }) : supabase.rpc("org_sign_ins", { p_org: orgId }),
    supabase.from("projects").select("id, display_name").order("sort_order"),
  ]);

  let events: Event[] = [
    ...(rows ?? []).map((r) => ({ at: r.at, who: nameOf(r.actor_email), via: r.via, text: describe(r), projectId: r.project_id })),
    ...(logins ?? []).map((l) => ({ at: l.at, who: nameOf(l.email), via: "app", text: "Σύνδεση", projectId: null })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const people = [...new Set(events.map((e) => e.who))].sort();
  if (who) events = events.filter((e) => e.who === who);

  const days = new Map<string, Event[]>();
  for (const e of events) days.set(dayKey(e.at), [...(days.get(dayKey(e.at)) ?? []), e]);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.display_name]));
  const qs = (next: { who?: string; project?: string }) => {
    const p = new URLSearchParams();
    if (next.who) p.set("who", next.who);
    if (next.project) p.set("project", next.project);
    const s = p.toString();
    return s ? `/activity?${s}` : "/activity";
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Ιστορικό</h1>
        <p className="text-sm text-ink-muted">Ποιος μπήκε και τι έκανε, από το πιο πρόσφατο.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={qs({ project })} className={`rounded px-2 py-1 ${!who ? "bg-ink text-surface" : "bg-bg"}`}>Όλοι</Link>
        {people.map((p) => (
          <Link key={p} href={qs({ who: p, project })} className={`rounded px-2 py-1 ${who === p ? "bg-ink text-surface" : "bg-bg"}`}>{p}</Link>
        ))}
        <span className="mx-2 text-ink-faint">|</span>
        <Link href={qs({ who })} className={`rounded px-2 py-1 ${!project ? "bg-ink text-surface" : "bg-bg"}`}>Όλα τα έργα</Link>
        {(projects ?? []).map((p) => (
          <Link key={p.id} href={qs({ who, project: p.id })} className={`rounded px-2 py-1 ${project === p.id ? "bg-ink text-surface" : "bg-bg"}`}>{p.display_name}</Link>
        ))}
      </div>

      {error && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-800">
          Το Ιστορικό δεν είναι ακόμα διαθέσιμο σε αυτή τη βάση ({error.message}).
        </Card>
      )}
      {!error && events.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">Δεν υπάρχει ακόμα δραστηριότητα.</p>}

      {[...days.entries()].map(([day, list]) => (
        <Card key={day}>
          <h2 className="mb-2 text-sm font-semibold first-letter:uppercase">{day}</h2>
          <ul className="flex flex-col">
            {list.map((e, i) => (
              <li key={i} className="flex gap-3 border-t border-line py-1.5 text-sm first:border-t-0">
                <span className="w-12 shrink-0 text-ink-faint">{timeOf(e.at)}</span>
                <span className="w-40 shrink-0 font-medium">
                  {e.who}
                  {e.via === "claude" && <span className="font-normal text-ink-faint"> (μέσω Claude)</span>}
                </span>
                <span className="min-w-0">
                  {e.text}
                  {e.projectId && !project && projectName.get(e.projectId) && (
                    <span className="text-ink-faint"> · {projectName.get(e.projectId)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
