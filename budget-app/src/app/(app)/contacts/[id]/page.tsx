import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, Badge } from "@/components/ui";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  CONTACT_KIND_LABEL,
  TX_STATUS_LABEL,
  VAT_STATUS_LABEL,
  type Contact,
  type Transaction,
  type Project,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [cRes, tRes, pRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("transactions")
      .select("*")
      .eq("contact_id", id)
      .order("tx_date", { ascending: false }),
    supabase.from("projects").select("*"),
  ]);

  const contact = cRes.data as Contact | null;
  if (!contact) notFound();

  const tx = (tRes.data ?? []) as Transaction[];
  const projects = (pRes.data ?? []) as Project[];
  const num = (n: number | string) => Number(n) || 0;
  const projName = (pid: string | null) =>
    projects.find((p) => p.id === pid)?.name ?? "—";

  const sum = (rows: Transaction[]) =>
    rows.reduce((s, t) => s + num(t.amount), 0);

  const exp = tx.filter((t) => t.type === "expense");
  const inc = tx.filter((t) => t.type === "income");
  const payable = sum(exp.filter((t) => t.status === "upcoming"));
  const paid = sum(exp.filter((t) => t.status === "paid"));
  const receivable = sum(inc.filter((t) => t.status === "upcoming"));
  const received = sum(inc.filter((t) => t.status === "paid"));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-primary"
        >
          <ArrowLeft size={14} /> Πίσω στις επαφές
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">{contact.name}</h1>
          <Badge tone="planned">{CONTACT_KIND_LABEL[contact.kind]}</Badge>
        </div>
        {contact.notes && (
          <p className="mt-1 text-sm text-muted">{contact.notes}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Της χρωστάμε</p>
            <p className="mt-1 text-xl font-bold text-negative">
              {formatEuro(payable)}
            </p>
            <p className="mt-1 text-[11px] text-muted">Εκκρεμή έξοδα</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Έχουμε πληρώσει</p>
            <p className="mt-1 text-xl font-bold">{formatEuro(paid)}</p>
            <p className="mt-1 text-[11px] text-muted">Πληρωμένα έξοδα</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Περιμένουμε</p>
            <p className="mt-1 text-xl font-bold text-positive">
              {formatEuro(receivable)}
            </p>
            <p className="mt-1 text-[11px] text-muted">Εκκρεμή έσοδα</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Έχουμε εισπράξει</p>
            <p className="mt-1 text-xl font-bold text-positive">
              {formatEuro(received)}
            </p>
            <p className="mt-1 text-[11px] text-muted">Εισπραγμένα έσοδα</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-muted">
            Ιστορικό κινήσεων ({tx.length})
          </h2>
        </div>
        {tx.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">
            Δεν υπάρχουν κινήσεις για αυτή την επαφή.
          </p>
        ) : (
          tx.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="font-medium">{t.notes || "—"}</p>
                <p className="text-xs text-muted">
                  {projName(t.project_id)} · {formatDate(t.tx_date)}
                  {num(t.vat_amount) > 0 &&
                    ` · ΦΠΑ ${formatEuro(num(t.vat_amount))} (${VAT_STATUS_LABEL[t.vat_status]})`}
                  {num(t.withholding_amount) > 0 &&
                    ` · Παρακρ. ${formatEuro(num(t.withholding_amount))}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={t.status}>{TX_STATUS_LABEL[t.status]}</Badge>
                <span
                  className={`font-semibold ${t.type === "income" ? "text-positive" : ""}`}
                >
                  {t.type === "income" ? "+" : "−"}
                  {formatEuro(num(t.amount))}
                </span>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
