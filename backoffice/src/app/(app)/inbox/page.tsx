import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { toChangeCard } from "@/lib/ai/changeCards";
import { loadInboxCounts } from "@/lib/data/inboxCount";
import { AiSpark, ButtonLink, LINK_CLASS, PageHeader, SpecTable, StatusDot, SUB_CLASS, Td, Th, Tr } from "@/components/ui";
import { ChangeCardView } from "../assistant/ChangeCardView";
import { CHANGE_COLUMNS } from "../assistant/PendingChanges";
import { CommitBar } from "./[batchId]/CommitBar";

const STATUS_TONE = { staged: "amber", committed: "green", undone: "neutral", discarded: "neutral" } as const;

function SectionTitle({ id, title, count, children }: { id: string; title: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-hairline pb-3">
      <h2 id={id} className="flex items-center gap-2 text-section font-normal text-ink">
        {title}
        <span className="num text-body text-muted">{count}</span>
      </h2>
      {children}
    </div>
  );
}

// One place for everything waiting on a person: captured rows to review,
// Kansha AI proposals to approve, and what was recently committed (undoable).
export default async function InboxPage() {
  const supabase = await createClient();
  const [orgId, access] = await Promise.all([getCurrentOrgId(supabase), getAccessContext()]);
  const canReview = access.kind === "internal" && access.membership.role !== "viewer";

  const [{ data: staged }, { data: changes }, { data: proposals }, { data: history }, counts] = await Promise.all([
    supabase
      .from("ingest_batches")
      .select("id, source, filename, row_count, created_at, accounts(name)")
      .eq("org_id", orgId)
      .eq("status", "staged")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_changes")
      .select(CHANGE_COLUMNS)
      .eq("org_id", orgId)
      .in("status", ["pending", "conflict"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("collab_ai_proposals")
      .select("id, kind, created_at, project_id, board_id, projects(display_name), boards(title)")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ingest_batches")
      .select("id, source, filename, status, row_count, version, meta, committed_at, undone_at, created_at")
      .eq("org_id", orgId)
      .in("status", ["committed", "undone"])
      .order("updated_at", { ascending: false })
      .limit(15),
    loadInboxCounts(orgId),
  ]);

  const stagedBatches = staged ?? [];
  const changeRows = changes ?? [];
  const proposalRows = proposals ?? [];
  const historyRows = history ?? [];

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.inbox}
        meta="Ό,τι περιμένει εσάς: κινήσεις προς έλεγχο, προτάσεις του AI για έγκριση και οι πρόσφατες καταχωρίσεις, με δυνατότητα αναίρεσης."
        actions={
          <ButtonLink href="/inbox/new" variant="primary">
            {`+ ${el.nav.capture}`}
          </ButtonLink>
        }
      />

      <section className="flex flex-col gap-4" aria-labelledby="inbox-review">
        <SectionTitle id="inbox-review" title="Προς έλεγχο" count={counts.rows} />
        {stagedBatches.length === 0 ? (
          <p className="text-body text-muted">
            Τίποτα προς έλεγχο.{" "}
            <Link href="/inbox/new" className="underline underline-offset-4 hover:text-ink">
              Νέα καταχώριση
            </Link>
          </p>
        ) : (
          <SpecTable label="Προς έλεγχο">
            <thead>
              <tr>
                <Th>Αρχείο</Th>
                <Th className="hidden sm:table-cell">Λογαριασμός</Th>
                <Th numeric>Γραμμές</Th>
                <Th numeric className="hidden md:table-cell">Ημ/νία</Th>
              </tr>
            </thead>
            <tbody>
              {stagedBatches.map((b) => {
                const account = Array.isArray(b.accounts) ? b.accounts[0] : b.accounts;
                return (
                  <Tr key={b.id}>
                    <Td strong>
                      <Link href={`/inbox/${b.id}`} className={LINK_CLASS}>
                        {b.filename ?? el.ingest.source[b.source]}
                      </Link>
                      <span className={SUB_CLASS}>{el.ingest.source[b.source]}</span>
                    </Td>
                    <Td className="hidden sm:table-cell">{account?.name ?? "—"}</Td>
                    <Td numeric>{b.row_count}</Td>
                    <Td numeric className="hidden md:table-cell">{formatDate(b.created_at)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="inbox-ai">
        <SectionTitle id="inbox-ai" title="Προτάσεις AI" count={counts.changes + counts.proposals}>
          <Link href="/assistant?panel=changes" className="inline-flex min-h-8 items-center text-body text-muted hover:text-ink">
            Ιστορικό αποφάσεων →
          </Link>
        </SectionTitle>
        {changeRows.length === 0 && proposalRows.length === 0 ? (
          <p className="text-body text-muted">Καμία εκκρεμής πρόταση αυτή τη στιγμή.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {changeRows.map((c) => (
              <ChangeCardView key={c.id} initial={toChangeCard(c)} canReview={canReview} />
            ))}
            {proposalRows.length > 0 && (
              <ul className="flex flex-col">
                {proposalRows.map((p) => {
                  const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
                  const board = Array.isArray(p.boards) ? p.boards[0] : p.boards;
                  const title = el.collabAi.proposal[p.kind as "canvas" | "tasks" | "milestones"] ?? p.kind;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 text-body text-ai">
                          <AiSpark /> {title}
                        </span>
                        <span className="text-small text-muted">
                          {[project?.display_name, board?.title, formatDate(p.created_at)].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <Link
                        href={`/collab/${p.project_id}/board/${p.board_id}`}
                        className="inline-flex min-h-10 items-center text-body text-ink underline-offset-4 hover:underline"
                      >
                        Άνοιγμα στον πίνακα →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="inbox-history">
        <SectionTitle id="inbox-history" title="Ιστορικό" count={historyRows.length} />
        {historyRows.length === 0 ? (
          <p className="text-body text-muted">Δεν έχει καταχωριστεί ακόμα τίποτα από τα Εισερχόμενα.</p>
        ) : (
          <ul className="flex flex-col">
            {historyRows.map((b) => {
              const legacy = !!(b.meta as { legacy?: boolean } | null)?.legacy;
              const when = b.status === "undone" ? b.undone_at : b.committed_at;
              return (
                <li key={b.id} className="flex flex-col gap-2 border-b border-hairline py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link href={`/inbox/${b.id}`} className="truncate text-body text-ink underline-offset-4 hover:underline">
                      {b.filename ?? el.ingest.source[b.source]}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1.5 text-small text-muted">
                      {el.ingest.source[b.source]} · <span className="num">{b.row_count}</span> γραμμές
                      {when ? ` · ${formatDate(when)}` : ""}
                      <StatusDot tone={STATUS_TONE[b.status]} label={el.ingest.batchStatus[b.status]} />
                    </span>
                  </div>
                  {canReview && b.status === "committed" && !legacy && (
                    <CommitBar batchId={b.id} status={b.status} version={b.version} pendingCount={0} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
