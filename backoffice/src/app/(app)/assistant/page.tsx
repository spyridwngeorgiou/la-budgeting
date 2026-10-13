import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, buttonClass, cn } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { getAccessContext } from "@/lib/supabase/access";
import { createClient } from "@/lib/supabase/server";
import { countPendingChanges } from "@/lib/data/pendingChanges";
import { ChatPanel } from "./ChatPanel";
import { PendingChanges } from "./PendingChanges";

// Kansha AI: one screen with one scroll. From md the page is exactly the
// window's height (main's 2rem + 2rem padding off) and only the
// conversation scrolls; on a phone the page itself is the scroll and the
// question box sticks to the bottom. «Εκκρεμότητες» is open whenever
// something waits (?panel=closed shuts it, ?panel=changes opens it anyway
// for the history of decisions): beside the chat from 1280px, a compact
// list above it below that.
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; panel?: string }>;
}) {
  const { q, panel } = await searchParams;
  const access = await getAccessContext();
  if (access.kind !== "internal") redirect("/login");
  const orgId = access.membership.orgId;
  // Approving needs write rights; a viewer has nothing to review here.
  const canReview = access.membership.role !== "viewer";
  const supabase = await createClient();
  const [pending, { data: conversations }] = await Promise.all([
    canReview ? countPendingChanges(orgId) : Promise.resolve(0),
    supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const showChanges = canReview && (panel === "changes" || (pending > 0 && panel !== "closed"));

  return (
    <div className="flex flex-col gap-6 md:h-[calc(100dvh-4rem)]">
      <PageHeader
        title={el.nav.assistant}
        meta={el.assistant.meta}
        actions={
          canReview && (
            <Link
              href={showChanges ? "/assistant?panel=closed" : "/assistant?panel=changes"}
              aria-expanded={showChanges}
              className={buttonClass(showChanges ? "ai" : "secondary", "md", showChanges ? "bg-ai-tint" : "")}
            >
              {el.nav.pending} ({pending})
            </Link>
          )
        }
      />
      <div
        className={cn(
          "flex min-w-0 flex-col gap-6 md:min-h-0 md:flex-1",
          showChanges && "xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-[minmax(0,1fr)]",
        )}
      >
        {/* First in the DOM, so it sits above the chat below 1280px, where
            it never takes more than half the height (the history opened). */}
        {showChanges && (
          <PendingChanges className="md:max-h-[45%] md:shrink-0 md:overflow-y-auto xl:order-2 xl:max-h-none xl:min-h-0" />
        )}
        <ChatPanel
          className="md:min-h-0 md:flex-1 xl:order-1"
          initialPrompt={q}
          canReview={canReview}
          initialConversations={(conversations ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }))}
        />
      </div>
    </div>
  );
}
