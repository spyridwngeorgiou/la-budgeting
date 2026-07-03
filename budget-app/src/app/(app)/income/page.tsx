import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro, formatDate } from "@/lib/utils";
import type { ExpectedIncome, Project } from "@/lib/types";
import { IncomeFormModal } from "./IncomeFormModal";
import { deleteIncome } from "./actions";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  const supabase = await createClient();
  const [incRes, projRes] = await Promise.all([
    supabase.from("expected_income").select("*").order("start_date"),
    supabase.from("projects").select("*").order("name"),
  ]);
  const items = (incRes.data ?? []) as ExpectedIncome[];
  const projects = (projRes.data ?? []) as Project[];
  const num = (n: number | string) => Number(n) || 0;

  const monthly = items
    .filter((i) => i.recurrence === "monthly")
    .reduce((s, i) => s + num(i.amount), 0);
  const oneoff = items
    .filter((i) => i.recurrence === "oneoff")
    .reduce((s, i) => s + num(i.amount), 0);
  const annual = monthly * 12 + oneoff;

  const projName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Αναμενόμενα έσοδα</h1>
          <p className="text-sm text-muted">
            Ενοίκια, διαχείριση και άλλες προβλεπόμενες εισροές
          </p>
        </div>
        <IncomeFormModal projects={projects} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Μηνιαία έσοδα</p>
            <p className="mt-1 text-2xl font-bold text-positive">
              {formatEuro(monthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Εφάπαξ έσοδα</p>
            <p className="mt-1 text-2xl font-bold">{formatEuro(oneoff)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">
              Πρόβλεψη 12 μηνών
            </p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatEuro(annual)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Δεν υπάρχουν αναμενόμενα έσοδα ακόμη.
          </p>
        ) : (
          items.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0"
            >
              <div>
                <p className="font-medium text-foreground">{i.label}</p>
                <p className="text-xs text-muted">
                  {projName(i.project_id)} · από {formatDate(i.start_date)}
                  {i.end_date ? ` έως ${formatDate(i.end_date)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={i.recurrence === "monthly" ? "active" : "planned"}>
                  {i.recurrence === "monthly" ? "Μηνιαίο" : "Εφάπαξ"}
                </Badge>
                <span className="text-lg font-semibold text-positive">
                  {formatEuro(num(i.amount))}
                </span>
                <IncomeFormModal income={i} projects={projects} />
                <DeleteButton
                  action={deleteIncome}
                  id={i.id}
                  confirmText="Διαγραφή εσόδου;"
                />
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
