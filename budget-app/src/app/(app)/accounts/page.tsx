import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro } from "@/lib/utils";
import { ACCOUNT_TYPE_LABEL, type Account } from "@/lib/types";
import { AccountFormModal } from "./AccountFormModal";
import { deleteAccount } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at");
  const accounts = (data ?? []) as Account[];
  const num = (n: number | string) => Number(n) || 0;

  const available = accounts.filter((a) => !a.is_incoming);
  const incoming = accounts.filter((a) => a.is_incoming);
  const totalAvailable = available.reduce((s, a) => s + num(a.balance), 0);
  const totalIncoming = incoming.reduce((s, a) => s + num(a.balance), 0);

  const Row = (a: Account) => (
    <div
      key={a.id}
      className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0"
    >
      <div>
        <p className="font-medium text-foreground">{a.name}</p>
        <Badge tone="planned">{ACCOUNT_TYPE_LABEL[a.type]}</Badge>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold">{formatEuro(num(a.balance))}</span>
        <AccountFormModal account={a} />
        <DeleteButton action={deleteAccount} id={a.id} confirmText="Διαγραφή λογαριασμού;" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Λογαριασμοί</h1>
          <p className="text-sm text-muted">
            Διαθέσιμα κεφάλαια και αναμενόμενα έσοδα
          </p>
        </div>
        <AccountFormModal />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Σύνολο διαθέσιμων</p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatEuro(totalAvailable)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">
              Σύνολο αναμενόμενων εσόδων
            </p>
            <p className="mt-1 text-2xl font-bold text-positive">
              {formatEuro(totalIncoming)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          Διαθέσιμα κεφάλαια
        </h2>
        <Card>
          {available.length ? (
            available.map(Row)
          ) : (
            <p className="p-6 text-center text-sm text-muted">
              Δεν υπάρχουν λογαριασμοί ακόμη.
            </p>
          )}
        </Card>
      </div>

      {incoming.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">
            Αναμενόμενα έσοδα
          </h2>
          <Card>{incoming.map(Row)}</Card>
        </div>
      )}
    </div>
  );
}
