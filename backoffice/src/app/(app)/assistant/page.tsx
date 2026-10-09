import Link from "next/link";
import { redirect } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { getAccessContext } from "@/lib/supabase/access";
import { countPendingChanges } from "@/lib/data/pendingChanges";
import { ChatPanel } from "./ChatPanel";
import { PendingChanges } from "./PendingChanges";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; panel?: string }>;
}) {
  const { q, panel } = await searchParams;
  const access = await getAccessContext();
  if (access.kind !== "internal") redirect("/login");
  // Approving needs write rights; a viewer has nothing to review here.
  const canReview = access.membership.role !== "viewer";
  const pending = canReview ? await countPendingChanges(access.membership.orgId) : 0;
  const showChanges = canReview && panel === "changes";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.assistant}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Ρωτήστε ελεύθερα για τα οικονομικά της επιχείρησης -- κάθε απάντηση βασίζεται σε
            πραγματικά δεδομένα, ποτέ σε εικασία, και συνδέεται με τις κινήσεις πίσω από κάθε αριθμό.
          </p>
        </div>
        {canReview && (
          <Link
            href={showChanges ? "/assistant" : "/assistant?panel=changes"}
            aria-expanded={showChanges}
            className={`rounded-md border px-3 py-1.5 text-sm whitespace-nowrap ${
              showChanges ? "border-ai-border bg-ai-bg font-medium text-ai-ink" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {el.nav.pending} ({pending})
          </Link>
        )}
      </div>
      <div className={showChanges ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}>
        <ChatPanel initialPrompt={q} />
        {showChanges && <PendingChanges />}
      </div>
    </div>
  );
}
