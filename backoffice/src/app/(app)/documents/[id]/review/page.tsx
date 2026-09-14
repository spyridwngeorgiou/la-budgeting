import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./ReviewForm";
import type { Extraction } from "@/lib/ai/schemas";

export default async function DraftReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("transaction_drafts")
    .select("id, document_id, extracted, proposed, needs_review_reasons, status")
    .eq("id", id)
    .maybeSingle();
  if (!draft) notFound();

  const [{ data: document }, { data: contacts }, { data: projects }, { data: categories }, { data: accounts }] =
    await Promise.all([
      draft.document_id
        ? supabase.from("documents").select("storage_path").eq("id", draft.document_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("contacts").select("id, name").order("name"),
      supabase.from("projects").select("id, display_name").order("sort_order"),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("accounts").select("id, name").order("sort_order"),
    ]);

  let imageUrl: string | null = null;
  if (document?.storage_path) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(document.storage_path, 300);
    imageUrl = data?.signedUrl ?? null;
  }

  return (
    <ReviewForm
      draftId={draft.id}
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
