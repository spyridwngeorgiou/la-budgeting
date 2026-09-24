import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro } from "@/lib/utils";
import {
  PROJECT_STATUS_LABEL,
  type Project,
  type Transaction,
  type Contact,
} from "@/lib/types";
import { ProjectFormModal } from "./ProjectFormModal";
import { deleteProject } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const [projectsRes, txRes, contactsRes] = await Promise.all([
    supabase.from("projects").select("*").order("created_at"),
    supabase.from("transactions").select("*"),
    supabase.from("contacts").select("*").order("name"),
  ]);
  const projects = (projectsRes.data ?? []) as Project[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const contacts = (contactsRes.data ?? []) as Contact[];

  const num = (n: number | string) => Number(n) || 0;
  const contactName = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name ?? "—";
  const totalsFor = (projectId: string) => {
    const rows = transactions.filter(
      (t) => t.project_id === projectId && t.type === "expense",
    );
    const total = rows.reduce((s, t) => s + num(t.amount), 0);
    const paid = rows
      .filter((t) => t.status === "paid")
      .reduce((s, t) => s + num(t.amount), 0);
    const upcoming = rows
      .filter((t) => t.status === "upcoming")
      .reduce((s, t) => s + num(t.amount), 0);
    const invoiced = rows
      .filter((t) => t.has_invoice)
      .reduce((s, t) => s + num(t.amount), 0);
    const cash = rows
      .filter((t) => !t.has_invoice)
      .reduce((s, t) => s + num(t.amount), 0);
    return { total, paid, upcoming, invoiced, cash };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Έργα</h1>
          <p className="text-sm text-muted">
            Διαχείριση όλων των έργων και των συνόλων τους
          </p>
        </div>
        <ProjectFormModal contacts={contacts} />
      </div>

      {projects.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          Δεν υπάρχουν έργα ακόμη. Πάτησε «Νέο έργο» για να ξεκινήσεις.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const { total, paid, upcoming, invoiced, cash } = totalsFor(p.id);
            const budgetTarget = num(p.budget_target ?? 0);
            const budgetProgressPct =
              budgetTarget > 0 ? Math.min(100, (total / budgetTarget) * 100) : 0;
            return (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-semibold text-foreground hover:text-primary hover:underline"
                  >
                    {p.name}
                  </Link>
                  <Badge tone={p.status}>
                    {PROJECT_STATUS_LABEL[p.status]}
                  </Badge>
                </div>
                <div className="mt-auto space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Γενικό σύνολο</span>
                    <span className="font-semibold text-primary">{formatEuro(total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Προϋπολογισμός</span>
                    <span className="font-medium">{formatEuro(budgetTarget)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Πληρωμένα</span>
                    <span className="font-medium">{formatEuro(paid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Επερχόμενα</span>
                    <span className="font-medium text-warning">
                      {formatEuro(upcoming)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                    <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">
                      Με παραστατικό: {formatEuro(invoiced)}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                      Χωρίς: {formatEuro(cash)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 text-[11px] text-muted">
                    <p>
                      Υπεύθυνος:{" "}
                      <span className="font-medium text-foreground">
                        {p.owner_contact_id ? contactName(p.owner_contact_id) : "—"}
                      </span>
                    </p>
                    <p className="text-right">
                      Διάστημα: {p.start_date ?? "—"} έως {p.end_date ?? "—"}
                    </p>
                  </div>
                  <div className="pt-2 text-[11px] text-muted">
                    Γενικό σύνολο προς Προϋπολογισμό: {Math.round(budgetProgressPct)}%
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${budgetProgressPct}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <ProjectFormModal project={p} contacts={contacts} />
                  <DeleteButton
                    action={deleteProject}
                    id={p.id}
                    confirmText="Διαγραφή έργου; Οι κινήσεις θα παραμείνουν χωρίς έργο."
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
