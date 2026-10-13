import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { assignMatches } from "@/lib/ingest/match/assign";
import type { MatchCandidate } from "@/lib/ingest/match/score";
import { hintForRow, type CategoryRef, type UtilityRef } from "@/lib/ingest/match/hints";
import { BUILTIN_PROFILES } from "@/lib/ingest/profiles/presets";
import { profileFromRow, type BankProfile } from "@/lib/ingest/profiles/types";
import type { CanonicalRow, IngestDecision } from "@/lib/ingest/types";
import { addDays } from "@/lib/dates";

// Server-side glue between the pure ingest library and the staging tables:
// load profiles, fetch match candidates, write ingest_rows + matches.
// Nothing here touches `transactions` -- only commit_ingest_batch does.

type Client = SupabaseClient<Database>;

// The org's own profiles plus the presets (both via RLS). Falls back to the
// in-code presets if the table is unreachable, so detection still works.
export async function loadProfiles(supabase: Client, orgId: string): Promise<BankProfile[]> {
  const { data, error } = await supabase
    .from("bank_import_profiles")
    .select("*")
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  if (error || !data || data.length === 0) return BUILTIN_PROFILES;
  return data.map((row) => profileFromRow(row));
}


const CANDIDATE_COLUMNS =
  "id, direction, status, gross_amount, tx_date, due_date, paid_on, account_id, invoice_number, mydata_mark, bank_reference, counterparty_afm, counterparty_name, plan_id, description, ingest_row_id, contacts(name, afm, iban, aliases)";

// Open commitments the statement could be paying (any age -- an invoice
// from last year can be paid this month), plus paid rows near the period
// on this account that no bank line has claimed yet (already recorded).
export async function loadCandidates(
  supabase: Client,
  orgId: string,
  accountId: string | null,
  periodStart: string,
  periodEnd: string,
): Promise<MatchCandidate[]> {
  const [{ data: open }, { data: paid }] = await Promise.all([
    supabase
      .from("transactions")
      .select(CANDIDATE_COLUMNS)
      .eq("org_id", orgId)
      .in("status", ["pending", "scheduled"])
      .lte("tx_date", addDays(periodEnd, 31))
      .limit(3000),
    supabase
      .from("transactions")
      .select(CANDIDATE_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "paid")
      .is("ingest_row_id", null)
      .gte("tx_date", addDays(periodStart, -120))
      .lte("tx_date", addDays(periodEnd, 10))
      .limit(3000),
  ]);
  const paidNear = (paid ?? []).filter((t) => {
    const on = t.paid_on ?? t.tx_date;
    return on >= addDays(periodStart, -10) && on <= addDays(periodEnd, 10) && (!accountId || !t.account_id || t.account_id === accountId);
  });
  return [...(open ?? []), ...paidNear].map((t) => {
    const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    return {
      id: t.id,
      direction: t.direction,
      status: t.status,
      grossAmount: Number(t.gross_amount),
      txDate: t.tx_date,
      dueDate: t.due_date,
      paidOn: t.paid_on,
      accountId: t.account_id,
      invoiceNumber: t.invoice_number,
      mydataMark: t.mydata_mark,
      bankReference: t.bank_reference,
      counterpartyAfm: t.counterparty_afm,
      counterpartyName: t.counterparty_name,
      contactName: contact?.name ?? null,
      contactAfm: contact?.afm ?? null,
      contactIban: contact?.iban ?? null,
      contactAliases: contact?.aliases ?? [],
      planId: t.plan_id,
      description: t.description,
      ingestRowId: t.ingest_row_id,
    };
  });
}

// Stage parsed movements into a batch: duplicate check against committed
// lines, matching, then one insert for the rows and one for the matches.
// Default decisions: an "auto" match is pre-selected, a mere suggestion is
// left undecided (the reviewer must pick), no match -> create, a line
// already imported -> skip, an unreadable line -> skip.
// Utilities registered per property and the org's categories, for the
// project/category hints (lib/ingest/match/hints.ts). One query each.
async function loadHintSources(supabase: Client, orgId: string): Promise<{ utilities: UtilityRef[]; categories: CategoryRef[] }> {
  const [{ data: utilities }, { data: categories }] = await Promise.all([
    supabase
      .from("property_utilities")
      .select("project_id, kind, match_keys, projects(display_name)")
      .eq("org_id", orgId)
      .eq("is_active", true),
    supabase.from("categories").select("id, name, kind, keywords").eq("org_id", orgId).eq("is_active", true).order("sort_order"),
  ]);
  return {
    utilities: (utilities ?? []).map((u) => {
      const project = Array.isArray(u.projects) ? u.projects[0] : u.projects;
      return { projectId: u.project_id, projectLabel: project?.display_name ?? null, kind: u.kind, matchKeys: u.match_keys ?? [] };
    }),
    categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name, kind: c.kind, keywords: c.keywords ?? [] })),
  };
}

export interface StageMovementsOptions {
  // false when the statement failed its own checks (running balance): no
  // match is pre-accepted -- each one waits for the reviewer.
  trustAuto?: boolean;
}

export async function stageMovements(
  supabase: Client,
  orgId: string,
  batchId: string,
  accountId: string | null,
  rows: CanonicalRow[],
  options: StageMovementsOptions = {},
): Promise<{ staged: number; duplicates: number }> {
  const trustAuto = options.trustAuto ?? true;
  const keys = rows.map((r) => r.externalKey).filter((k): k is string => !!k);
  const { data: committed } = keys.length
    ? await supabase
        .from("ingest_rows")
        .select("external_key")
        .eq("org_id", orgId)
        .in("external_key", keys)
        .not("committed_at", "is", null)
    : { data: [] as { external_key: string | null }[] };
  const seen = new Set((committed ?? []).map((r) => r.external_key));

  const dated = rows.map((r) => r.txDate).filter((d): d is string => !!d).sort();
  const [candidates, hintSources] = await Promise.all([
    dated.length ? loadCandidates(supabase, orgId, accountId, dated[0], dated[dated.length - 1]) : Promise.resolve([]),
    loadHintSources(supabase, orgId),
  ]);
  const fresh = rows.filter((r) => !(r.externalKey && seen.has(r.externalKey)));
  const assignments = assignMatches(fresh, candidates);
  const byRow = new Map(fresh.map((r, i) => [r, assignments[i]]));

  const inserts = rows.map((r) => {
    const a = byRow.get(r);
    const duplicate = !a;
    const unreadable = r.amount === null || !r.txDate || !r.direction;
    let decision: IngestDecision = "create";
    let targets: string[] = [];
    if (duplicate || unreadable) decision = "skip";
    else if (a.confidence === "auto" && trustAuto) {
      decision = a.decision;
      targets = a.targets;
    } else if (a.confidence === "auto" || a.confidence === "suggest") {
      decision = "pending";
    }
    // A settled/linked line takes the existing transaction's assignment;
    // the hint matters only for what becomes a new transaction.
    const hint = hintForRow(r, hintSources.utilities, hintSources.categories);
    const meta = {
      ...(r.meta ?? {}),
      ...(a ? { confidence: a.confidence, score: a.score } : {}),
      ...(hint.reason
        ? { hint: { reason: hint.reason, project: hint.projectLabel, category: hint.categoryName, utility_kind: hint.utilityKind } }
        : {}),
    };
    return {
      org_id: orgId,
      batch_id: batchId,
      row_no: r.rowNo,
      row_kind: r.kind,
      raw: r.raw as Json,
      extracted: r.extracted as unknown as Json,
      meta: meta as Json,
      project_id: hint.projectId,
      category_id: hint.categoryId,
      external_key: r.externalKey,
      tx_date: r.txDate,
      value_date: r.valueDate,
      direction: r.direction,
      amount: r.amount,
      description: r.description,
      counterparty_name: r.counterpartyName,
      counterparty_afm: r.counterpartyAfm,
      counterparty_iban: r.counterpartyIban,
      reference: r.reference,
      balance_after: r.balanceAfter,
      account_id: accountId,
      dedup_status: duplicate ? ("dup_external_key" as const) : a.decision === "link_existing" ? ("already_recorded" as const) : ("new" as const),
      decision,
      decision_targets: targets,
      parse_errors: r.parseErrors,
    };
  });

  const { data: inserted, error } = await supabase.from("ingest_rows").insert(inserts).select("id, row_no");
  if (error) throw new Error(error.message);
  const idByRowNo = new Map((inserted ?? []).map((r) => [r.row_no, r.id]));

  const matches = fresh.flatMap((r) =>
    (byRow.get(r)?.matches ?? []).map((m, rank) => ({
      org_id: orgId,
      row_id: idByRowNo.get(r.rowNo)!,
      rank,
      kind: m.kind,
      transaction_ids: m.transactionIds,
      score: m.score,
      reasons: m.reasons as unknown as Json,
    })),
  );
  if (matches.length > 0) {
    const { error: matchError } = await supabase.from("ingest_row_matches").insert(matches);
    if (matchError) throw new Error(matchError.message);
  }
  return { staged: rows.length, duplicates: rows.length - fresh.length };
}
