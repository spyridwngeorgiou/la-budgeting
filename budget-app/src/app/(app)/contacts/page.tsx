import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro } from "@/lib/utils";
import {
  CONTACT_KIND_LABEL,
  CONTACT_TYPE_LABEL,
  type Contact,
  type Transaction,
} from "@/lib/types";
import { ContactFormModal } from "./ContactFormModal";
import { deleteContact } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const supabase = await createClient();
  const [cRes, tRes] = await Promise.all([
    supabase.from("contacts").select("*").order("name"),
    supabase.from("transactions").select("*"),
  ]);
  const contacts = (cRes.data ?? []) as Contact[];
  const tx = (tRes.data ?? []) as Transaction[];
  const num = (n: number | string) => Number(n) || 0;

  const totalsFor = (contactId: string) => {
    const rows = tx.filter((t) => t.contact_id === contactId);
    const payable = rows
      .filter((t) => t.type === "expense" && t.status === "upcoming")
      .reduce((s, t) => s + num(t.amount), 0);
    const receivable = rows
      .filter((t) => t.type === "income" && t.status === "upcoming")
      .reduce((s, t) => s + num(t.amount), 0);
    return { payable, receivable, count: rows.length };
  };

  const totalPayable = contacts.reduce(
    (s, c) => s + totalsFor(c.id).payable,
    0,
  );
  const totalReceivable = contacts.reduce(
    (s, c) => s + totalsFor(c.id).receivable,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Επαφές</h1>
          <p className="text-sm text-muted">
            Συνεργάτες, προμηθευτές & αρχές — τι χρωστάμε και τι περιμένουμε
          </p>
        </div>
        <ContactFormModal />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">
            Συνολικά πληρωτέα (σε επαφές)
          </p>
          <p className="mt-1 text-2xl font-bold text-negative">
            {formatEuro(totalPayable)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">
            Συνολικά εισπρακτέα (από επαφές)
          </p>
          <p className="mt-1 text-2xl font-bold text-positive">
            {formatEuro(totalReceivable)}
          </p>
        </Card>
      </div>

      {contacts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          Δεν υπάρχουν επαφές ακόμη.
        </Card>
      ) : (
        <Card>
          {contacts.map((c) => {
            const { payable, receivable, count } = totalsFor(c.id);
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/contacts/${c.id}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge tone="planned">{CONTACT_KIND_LABEL[c.kind]}</Badge>
                    <Badge tone="active">
                      {CONTACT_TYPE_LABEL[c.contact_type] ?? CONTACT_TYPE_LABEL.supplier}
                    </Badge>
                    <span className="text-xs text-muted">
                      {count} κινήσεις
                    </span>
                  </div>
                  {(c.vat_number || c.payment_terms_days || c.email || c.phone) && (
                    <p className="mt-1 text-xs text-muted">
                      {c.vat_number ? `ΑΦΜ: ${c.vat_number}` : ""}
                      {c.vat_number && c.payment_terms_days ? " · " : ""}
                      {c.payment_terms_days ? `Όροι: ${c.payment_terms_days} ημέρες` : ""}
                      {(c.vat_number || c.payment_terms_days) && (c.email || c.phone) ? " · " : ""}
                      {c.email ? c.email : c.phone ?? ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[11px] text-muted">Χρωστάμε</p>
                    <p
                      className={`text-sm font-semibold ${payable > 0 ? "text-negative" : "text-muted"}`}
                    >
                      {formatEuro(payable)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted">Περιμένουμε</p>
                    <p
                      className={`text-sm font-semibold ${receivable > 0 ? "text-positive" : "text-muted"}`}
                    >
                      {formatEuro(receivable)}
                    </p>
                  </div>
                  <ContactFormModal contact={c} />
                  <DeleteButton
                    action={deleteContact}
                    id={c.id}
                    confirmText="Διαγραφή επαφής; Οι κινήσεις θα μείνουν χωρίς επαφή."
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
