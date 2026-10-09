import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/finance/money";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import type { StatementSummary } from "@/lib/ingest/types";
import { CommitBar } from "./CommitBar";
import { RowDecision, decisionForKind, type MatchOption } from "./RowDecision";

const STATUS_TONE = { staged: "amber", committed: "green", undone: "neutral", discarded: "neutral" } as const;

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function InboxBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("ingest_batches")
    .select("*, accounts(name)")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) notFound();
  const meta = (batch.meta ?? {}) as { needs_mapping?: boolean; warnings?: string[]; statement?: StatementSummary | null };
  if (meta.needs_mapping && batch.row_count === 0 && batch.status === "staged") redirect(`/inbox/mapping/${batchId}`);

  const { data: rows } = await supabase
    .from("ingest_rows")
    .select(
      "id, row_no, tx_date, value_date, direction, amount, description, counterparty_name, reference, decision, decision_targets, dedup_status, parse_errors, committed_transaction_id, ingest_row_matches(rank, kind, transaction_ids, score, reasons)",
    )
    .eq("batch_id", batchId)
    .order("row_no");

  const targetIds = [
    ...new Set(
      (rows ?? []).flatMap((r) => [...r.decision_targets, ...(r.ingest_row_matches ?? []).flatMap((m) => m.transaction_ids)]),
    ),
  ];
  const [{ data: targets }, ledgerOpening] = await Promise.all([
    targetIds.length
      ? supabase
          .from("transactions")
          .select("id, tx_date, gross_amount, description, invoice_number, counterparty_name, contacts(name)")
          .in("id", targetIds)
      : Promise.resolve({ data: [] as never[] }),
    batch.account_id && batch.period_start
      ? supabase.rpc("account_balance_as_of", { p_account: batch.account_id, p_date: dayBefore(batch.period_start) })
      : Promise.resolve({ data: null }),
  ]);
  const txLabel = new Map(
    (targets ?? []).map((t) => {
      const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
      const who = contact?.name ?? t.counterparty_name ?? t.description ?? "—";
      return [t.id, `${formatDate(t.tx_date)} ${who}${t.invoice_number ? ` ${t.invoice_number}` : ""} ${formatMoney(t.gross_amount)}`];
    }),
  );

  const account = Array.isArray(batch.accounts) ? batch.accounts[0] : batch.accounts;
  const editable = batch.status === "staged" || batch.status === "undone";
  const pendingCount = (rows ?? []).filter((r) => r.decision === "pending").length;
  const signedSum = (rows ?? []).reduce(
    (s, r) => s + (r.amount === null ? 0 : (r.direction === "expense" ? -1 : 1) * toCents(r.amount)),
    0,
  );
  const statement = meta.statement ?? null;
  const opening = batch.opening_balance;
  const closing = batch.closing_balance;
  const arithmeticOk = opening !== null && closing !== null ? toCents(opening) + signedSum === toCents(closing) : null;
  const ledgerOk = opening !== null && typeof ledgerOpening.data === "number" ? toCents(ledgerOpening.data) === toCents(opening) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/inbox" className="text-xs text-ink-muted hover:underline">
            ← {el.nav.inbox}
          </Link>
          <h1 className="text-xl font-semibold">{batch.filename}</h1>
          <p className="text-sm text-ink-muted">
            {account?.name ?? "—"} · {batch.period_start ? `${formatDate(batch.period_start)} – ${formatDate(batch.period_end)}` : "—"} ·{" "}
            {rows?.length ?? 0} γραμμές <Badge tone={STATUS_TONE[batch.status]}>{el.ingest.batchStatus[batch.status]}</Badge>
          </p>
        </div>
        <CommitBar batchId={batch.id} status={batch.status} version={batch.version} pendingCount={pendingCount} />
      </div>

      {/* Statement check: opening + Σ movements = closing, and the opening
          against what the ledger says the account held the day before. */}
      {opening !== null && (
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-muted">Υπόλοιπο έναρξης (αντίγραφο)</div>
            <div className="font-mono">{formatMoney(opening)}</div>
            {ledgerOk !== null && (
              <div className={`text-xs ${ledgerOk ? "text-sage-ink" : "text-amber-ink"}`}>
                Σύστημα: {formatMoney(ledgerOpening.data as number)} {ledgerOk ? "✓" : "— διαφέρει"}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-ink-muted">Σ κινήσεων</div>
            <div className="font-mono">{formatMoney(signedSum / 100)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Υπόλοιπο λήξης</div>
            <div className="font-mono">{formatMoney(closing)}</div>
            {arithmeticOk !== null && (
              <div className={`text-xs ${arithmeticOk && statement?.balanceConsistent !== false ? "text-sage-ink" : "text-red-ink"}`}>
                {arithmeticOk && statement?.balanceConsistent !== false ? "Η αριθμητική του αντιγράφου συμφωνεί ✓" : "Η αριθμητική δεν συμφωνεί"}
              </div>
            )}
          </div>
        </div>
      )}

      {(meta.warnings ?? []).length > 0 && (
        <ul className="list-disc rounded-lg border border-amber-ink/40 bg-amber-bg p-3 pl-7 text-sm text-amber-ink">
          {meta.warnings!.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">Ημ/νία</th>
              <th className="p-2">Περιγραφή</th>
              <th className="p-2 text-right">Ποσό</th>
              <th className="p-2">Απόφαση</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const options: MatchOption[] = [...(r.ingest_row_matches ?? [])]
                .sort((a, b) => a.rank - b.rank)
                .map((m) => ({
                  decision: decisionForKind(m.kind),
                  transactionIds: m.transaction_ids,
                  label: m.transaction_ids.map((id) => txLabel.get(id) ?? "—").join(" + "),
                  score: m.score,
                  reasons: (m.reasons ?? []) as MatchOption["reasons"],
                }));
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="p-2 text-ink-muted">{r.row_no}</td>
                  <td className="p-2 whitespace-nowrap">{formatDate(r.tx_date)}</td>
                  <td className="p-2">
                    <div className="whitespace-pre-line">{r.description ?? "—"}</div>
                    {r.reference && <div className="text-xs text-ink-muted">{r.reference}</div>}
                    {r.dedup_status === "dup_external_key" && <Badge tone="neutral">Ήδη εισηγμένη σε προηγούμενο αρχείο</Badge>}
                    {r.parse_errors.map((e) => (
                      <div key={e} className="text-xs text-red-ink">
                        {e}
                      </div>
                    ))}
                  </td>
                  <td className={`p-2 text-right font-mono whitespace-nowrap ${r.direction === "expense" ? "text-red-ink" : "text-sage-ink"}`}>
                    {r.amount === null ? "—" : `${r.direction === "expense" ? "−" : "+"}${formatMoney(r.amount)}`}
                  </td>
                  <td className="p-2">
                    <RowDecision
                      batchId={batch.id}
                      rowId={r.id}
                      decision={r.decision}
                      targets={r.decision_targets}
                      options={options}
                      editable={editable}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
