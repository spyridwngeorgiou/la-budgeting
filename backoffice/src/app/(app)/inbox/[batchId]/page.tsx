import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { toCents } from "@/lib/finance/money";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { specRow, specTable, specTd, specTh } from "@/components/specTable";
import { loadLookups } from "@/lib/data/lookups";
import type { Extraction } from "@/lib/ai/schemas";
import type { AiRowMeta } from "@/lib/ingest/adapters/aiShared";
import type { AadeDedupStatus } from "@/lib/aade/dedup";
import type { StatementSummary } from "@/lib/ingest/types";
import { CommitBar } from "./CommitBar";
import { RowDecision, decisionForKind, type MatchOption } from "./RowDecision";
import { AssignSelect, BulkAssignBar, ReviewProvider, RowCheckbox, type ReviewLookups } from "./ReviewContext";
import { CaptureReview } from "./CaptureReview";
import { addDays } from "@/lib/dates";

const STATUS_TONE = { staged: "amber", committed: "green", undone: "neutral", discarded: "neutral" } as const;
// Sources whose rows are documents with their own assignment (vs bank lines
// that inherit the statement's account and settle open items).
const DOCUMENT_SOURCES = new Set(["aade", "ai_document", "ai_nl", "ai_email"]);
const AI_SOURCES = new Set(["ai_document", "ai_nl", "ai_email"]);

function dayBefore(iso: string): string {
  return addDays(iso, -1);
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
  const meta = (batch.meta ?? {}) as {
    needs_mapping?: boolean;
    warnings?: string[];
    statement?: StatementSummary | null;
    legacy?: boolean;
    period?: string | null;
  };
  if (meta.needs_mapping && batch.row_count === 0 && batch.status === "staged") redirect(`/inbox/mapping/${batchId}`);
  const isDocuments = DOCUMENT_SOURCES.has(batch.source);
  const isAi = AI_SOURCES.has(batch.source);

  const { data: rows } = await supabase
    .from("ingest_rows")
    .select(
      "id, row_no, row_kind, raw, meta, tx_date, value_date, due_date, direction, amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, status, paid_on, scope, description, counterparty_name, counterparty_afm, invoice_number, mydata_mark, reference, project_id, category_id, account_id, contact_id, document_id, decision, decision_targets, dedup_status, parse_errors, committed_transaction_id, ingest_row_matches(rank, kind, transaction_ids, score, reasons)",
    )
    .eq("batch_id", batchId)
    .order("row_no");

  const targetIds = [
    ...new Set(
      (rows ?? []).flatMap((r) => [...r.decision_targets, ...(r.ingest_row_matches ?? []).flatMap((m) => m.transaction_ids)]),
    ),
  ];
  const documentIds = [...new Set((rows ?? []).map((r) => r.document_id).filter((d): d is string => !!d))];
  const [{ data: targets }, ledgerOpening, lookups, { data: documents }] = await Promise.all([
    targetIds.length
      ? supabase
          .from("transactions")
          .select("id, tx_date, gross_amount, description, invoice_number, counterparty_name, contacts(name)")
          .in("id", targetIds)
      : Promise.resolve({ data: [] as never[] }),
    batch.account_id && batch.period_start
      ? supabase.rpc("account_balance_as_of", { p_account: batch.account_id, p_date: dayBefore(batch.period_start) })
      : Promise.resolve({ data: null }),
    isDocuments
      ? getCurrentOrgId(supabase).then((orgId) =>
          loadLookups(supabase, orgId, { include: isAi ? undefined : ["projects", "categories", "accounts"] }),
        )
      : Promise.resolve(null),
    documentIds.length
      ? supabase.from("documents").select("id, storage_path, mime_type").in("id", documentIds)
      : Promise.resolve({ data: [] as { id: string; storage_path: string; mime_type: string | null }[] }),
  ]);

  // Short-lived links to the photos/PDFs the AI rows were read from.
  const documentLinks = new Map<string, { url: string; mime: string | null }>();
  for (const d of documents ?? []) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 600);
    if (data?.signedUrl) documentLinks.set(d.id, { url: data.signedUrl, mime: d.mime_type });
  }

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

  const reviewLookups: ReviewLookups = {
    contacts: (lookups?.contacts ?? []).map((c) => ({ id: c.id, label: c.name })),
    projects: (lookups?.projects ?? []).map((p) => ({ id: p.id, label: p.display_name })),
    categories: (lookups?.categories ?? []).map((c) => ({ id: c.id, label: c.name })),
    accounts: (lookups?.accounts ?? []).map((a) => ({ id: a.id, label: a.name })),
  };

  const subtitle = isDocuments
    ? [el.ingest.source[batch.source], meta.period ?? (batch.created_at ? formatDate(batch.created_at) : null)]
    : [account?.name ?? "—", batch.period_start ? `${formatDate(batch.period_start)} – ${formatDate(batch.period_end)}` : "—"];

  return (
    <ReviewProvider batchId={batch.id} editable={editable} lookups={reviewLookups}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-rule pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Link href="/inbox" className="eyebrow inline-flex min-h-8 items-center text-muted hover:text-ink">
              ← {el.nav.inbox}
            </Link>
            <h1 className="text-title font-normal break-words text-ink">{batch.filename ?? el.ingest.source[batch.source]}</h1>
            <p className="text-small text-muted">
              {subtitle.filter(Boolean).join(" · ")} · {rows?.length ?? 0} γραμμές{" "}
              <Badge tone={STATUS_TONE[batch.status]}>{el.ingest.batchStatus[batch.status]}</Badge>
            </p>
            {meta.legacy && <p className="text-xs text-muted">{el.ingest.review.legacy}</p>}
          </div>
          <CommitBar
            batchId={batch.id}
            status={batch.status}
            version={batch.version}
            pendingCount={pendingCount}
            undoable={!meta.legacy}
          />
        </div>

        {/* Statement check: opening + Σ movements = closing, and the opening
            against what the ledger says the account held the day before. */}
        {opening !== null && (
          <div className="grid grid-cols-1 gap-y-4 border-b border-hairline pb-4 text-sm sm:grid-cols-3 sm:gap-x-0 sm:[&>*:not(:first-child)]:border-l sm:[&>*:not(:first-child)]:border-hairline sm:[&>*:not(:first-child)]:pl-6">
            <div>
              <div className="eyebrow text-muted">Υπόλοιπο έναρξης (αντίγραφο)</div>
              <div className="num mt-1 text-figure-sm font-light text-ink">{formatMoney(opening)}</div>
              {ledgerOk !== null && (
                <div className={`mt-1 text-xs ${ledgerOk ? "text-muted" : "border-l-2 border-warning pl-2 text-warning"}`}>
                  Σύστημα: {formatMoney(ledgerOpening.data as number)} {ledgerOk ? "✓" : "— διαφέρει"}
                </div>
              )}
            </div>
            <div>
              <div className="eyebrow text-muted">Σ κινήσεων</div>
              <div className="num mt-1 text-figure-sm font-light text-ink">{formatMoney(signedSum / 100)}</div>
            </div>
            <div>
              <div className="eyebrow text-muted">Υπόλοιπο λήξης</div>
              <div className="num mt-1 text-figure-sm font-light text-ink">{formatMoney(closing)}</div>
              {arithmeticOk !== null && (
                <div className={`mt-1 text-xs ${arithmeticOk && statement?.balanceConsistent !== false ? "text-muted" : "border-l-2 border-negative pl-2 text-negative"}`}>
                  {arithmeticOk && statement?.balanceConsistent !== false ? "Η αριθμητική του αντιγράφου συμφωνεί ✓" : "Η αριθμητική δεν συμφωνεί"}
                </div>
              )}
            </div>
          </div>
        )}

        {(meta.warnings ?? []).length > 0 && (
          <ul className="list-disc border-l-2 border-warning py-1 pr-2 pl-8 text-sm text-warning">
            {meta.warnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {isDocuments && (rows?.length ?? 0) > 1 && <BulkAssignBar />}

        <div className="overflow-x-auto">
          <table className={specTable}>
            <thead>
              <tr>
                {isDocuments && <th scope="col" className={specTh} />}
                <th scope="col" className={`${specTh} text-right`}>#</th>
                <th scope="col" className={specTh}>Ημ/νία</th>
                <th scope="col" className={specTh}>{isDocuments ? el.ingest.review.counterparty : "Περιγραφή"}</th>
                <th scope="col" className={`${specTh} text-right`}>Ποσό</th>
                {isDocuments && <th scope="col" className={specTh}>{el.ingest.review.assignment}</th>}
                <th scope="col" className={specTh}>Απόφαση</th>
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
                const rowMeta = (r.meta ?? {}) as { ai?: AiRowMeta; aade_dedup_status?: AadeDedupStatus };
                const rowEditable = editable && !r.committed_transaction_id;
                const doc = r.document_id ? documentLinks.get(r.document_id) : undefined;
                return (
                  <tr key={r.id} className={specRow}>
                    {isDocuments && (
                      <td className={specTd}>{rowEditable && r.decision !== "skip" && <RowCheckbox rowId={r.id} />}</td>
                    )}
                    <td className={`${specTd} num text-right text-muted`}>{r.row_no}</td>
                    <td className={`${specTd} num`}>{formatDate(r.tx_date)}</td>
                    <td className={`${specTd} text-ink`}>
                      {isDocuments ? (
                        <>
                          <div>{r.counterparty_name ?? "—"}</div>
                          <div className="text-xs text-muted">
                            {[r.counterparty_afm, r.invoice_number, r.mydata_mark && `ΜΑΡΚ ${r.mydata_mark}`].filter(Boolean).join(" · ")}
                          </div>
                          {r.description && <div className="text-xs text-muted">{r.description}</div>}
                        </>
                      ) : (
                        <>
                          <div className="whitespace-pre-line">{r.description ?? "—"}</div>
                          {r.reference && <div className="text-xs text-muted">{r.reference}</div>}
                        </>
                      )}
                      {r.dedup_status === "dup_external_key" && <Badge tone="neutral">Ήδη εισηγμένη σε προηγούμενο αρχείο</Badge>}
                      {rowMeta.aade_dedup_status && rowMeta.aade_dedup_status !== "new" && (
                        <Badge tone="neutral">{el.ingest.aadeDedup[rowMeta.aade_dedup_status]}</Badge>
                      )}
                      {(rowMeta.ai?.needs_review_reasons ?? []).map((reason) => (
                        <div key={reason} className="mt-1 border-l-2 border-warning pl-2 text-xs text-warning">
                          {reason}
                        </div>
                      ))}
                      {r.parse_errors.map((e) => (
                        <div key={e} className="mt-1 border-l-2 border-negative pl-2 text-xs text-negative">
                          {e}
                        </div>
                      ))}
                    </td>
                    <td className={`${specTd} num text-right text-ink`}>
                      {r.amount === null ? "—" : `${r.direction === "expense" ? "−" : "+"}${formatMoney(r.amount)}`}
                    </td>
                    {isDocuments && (
                      <td className={specTd}>
                        {r.decision === "skip" && !rowEditable ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <div className="flex min-w-44 flex-col gap-1">
                            <AssignSelect rowId={r.id} field="project_id" value={r.project_id} />
                            <AssignSelect rowId={r.id} field="category_id" value={r.category_id} />
                            <AssignSelect rowId={r.id} field="account_id" value={r.account_id} />
                          </div>
                        )}
                      </td>
                    )}
                    <td className={specTd}>
                      <div className="flex flex-col items-start gap-1">
                        <RowDecision
                          batchId={batch.id}
                          rowId={r.id}
                          decision={r.decision}
                          targets={r.decision_targets}
                          options={options}
                          editable={rowEditable}
                        />
                        {isAi && rowEditable && (
                          <CaptureReview
                            rowId={r.id}
                            rowNo={r.row_no}
                            values={{
                              direction: r.direction,
                              tx_date: r.tx_date,
                              due_date: r.due_date,
                              status: r.status,
                              paid_on: r.paid_on,
                              scope: r.scope,
                              counterparty_name: r.counterparty_name,
                              counterparty_afm: r.counterparty_afm,
                              contact_id: r.contact_id,
                              project_id: r.project_id,
                              category_id: r.category_id,
                              account_id: r.account_id,
                              has_invoice: r.has_invoice,
                              net_amount: r.net_amount,
                              vat_rate: r.vat_rate,
                              withholding_amount: r.withholding_amount,
                              amount: r.amount,
                              invoice_number: r.invoice_number,
                              mydata_mark: r.mydata_mark,
                              description: r.description,
                            }}
                            extraction={(r.raw ?? null) as unknown as Extraction | null}
                            needsReview={rowMeta.ai?.needs_review_reasons ?? []}
                            documentUrl={doc?.url ?? null}
                            documentMime={doc?.mime ?? null}
                          />
                        )}
                        {isAi && !rowEditable && doc && (
                          <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline underline-offset-4 hover:text-ink">
                            {el.ingest.review.openDocument}
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ReviewProvider>
  );
}
