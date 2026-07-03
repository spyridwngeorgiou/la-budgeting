import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  ACCOUNT_TYPE_LABEL,
  type ExpectedIncome,
  type Project,
  type Account,
} from "@/lib/types";
import { IncomeFormModal } from "./IncomeFormModal";
import { deleteIncome } from "./actions";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  const supabase = await createClient();
  const [incRes, projRes, accRes] = await Promise.all([
    supabase.from("expected_income").select("*").order("start_date"),
    supabase.from("projects").select("*").order("name"),
    supabase.from("accounts").select("*").eq("is_incoming", true).order("name"),
  ]);
  const items = (incRes.data ?? []) as ExpectedIncome[];
  const projects = (projRes.data ?? []) as Project[];
  const incomingAccounts = (accRes.data ?? []) as Account[];
  const num = (n: number | string) => Number(n) || 0;

  const generalIncoming = incomingAccounts
    .filter((a) => !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);
  const earmarkedIncoming = incomingAccounts
    .filter((a) => a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);

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
            Αναμενόμενα κεφάλαια & προβλεπόμενες εισροές (ενοίκια, διαχείριση)
          </p>
        </div>
        <IncomeFormModal projects={projects} />
      </div>

      {/* Αναμενόμενα κεφάλαια από λογαριασμούς (δάνειο, αναμενόμενα κ.λπ.) */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted">
            Αναμενόμενα κεφάλαια (από λογαριασμούς)
          </h2>
          <span className="text-sm text-muted">
            Γενικά:{" "}
            <strong className="text-positive">
              {formatEuro(generalIncoming)}
            </strong>
            {earmarkedIncoming > 0 && (
              <>
                {"  ·  "}Δεσμευμένα (έργων):{" "}
                <strong className="text-accent">
                  {formatEuro(earmarkedIncoming)}
                </strong>
              </>
            )}
          </span>
        </div>
        <Card>
          {incomingAccounts.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              Δεν υπάρχουν αναμενόμενα κεφάλαια. Πρόσθεσέ τα στους «Λογαριασμούς»
              με επιλογή «Αναμενόμενο έσοδο».
            </p>
          ) : (
            incomingAccounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0"
              >
                <div>
                  <p className="font-medium text-foreground">{a.name}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="planned">{ACCOUNT_TYPE_LABEL[a.type]}</Badge>
                    {a.project_id ? (
                      <Badge tone="active">
                        Έργο: {projName(a.project_id)}
                      </Badge>
                    ) : (
                      <Badge tone="completed">Γενικό</Badge>
                    )}
                  </div>
                </div>
                <span className="text-lg font-semibold text-positive">
                  {formatEuro(num(a.balance))}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <h2 className="pt-2 text-sm font-semibold text-muted">
        Προβλεπόμενα επαναλαμβανόμενα έσοδα (ενοίκια / διαχείριση)
      </h2>

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
