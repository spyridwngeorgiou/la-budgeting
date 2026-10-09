import { notFound, redirect } from "next/navigation";
import { legacyInboxHref } from "@/lib/ingest/legacy";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./ReviewForm";
import type { Extraction } from "@/lib/ai/schemas";
import { loadLookups } from "@/lib/data/lookups";
import { getCurrentOrgId } from "@/lib/supabase/org";

export default async function DraftReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queue?: string }>;
}) {
  const { id } = await params;
  const { queue } = await searchParams;
  const supabase = await createClient();
  const inbox = await legacyInboxHref(supabase, `draft:${id}`);
  if (inbox) redirect(inbox);

  const { data: draft } = await supabase
    .from("transaction_drafts")
    .select("id, document_id, extracted, proposed, needs_review_reasons, status")
    .eq("id", id)
    .maybeSingle();
  if (!draft) notFound();

  const orgId = await getCurrentOrgId(supabase);
  const [{ data: document }, { contacts, projects, categories, accounts }] = await Promise.all([
    draft.document_id
      ? supabase.from("documents").select("storage_path").eq("id", draft.document_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadLookups(supabase, orgId),
  ]);

  let imageUrl: string | null = null;
  if (document?.storage_path) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(document.storage_path, 300);
    imageUrl = data?.signedUrl ?? null;
  }

  return (
    <ReviewForm
      draftId={draft.id}
      queue={queue ?? ""}
      extraction={draft.extracted as unknown as Extraction}
      proposed={draft.proposed as { contact_id: string | null; project_id: string | null; category_id: string | null; direction?: "income" | "expense" }}
      needsReviewReasons={(draft.needs_review_reasons as string[]) ?? []}
      status={draft.status}
      imageUrl={imageUrl}
      contacts={(contacts ?? []).map((c) => ({ id: c.id, label: c.name }))}
      projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_name }))}
      categories={(categories ?? []).map((c) => ({ id: c.id, label: c.name }))}
      accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))}
    />
  );
}
