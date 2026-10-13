import Link from "next/link";
import { MessageSquareText, PenLine, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { getAccessContext } from "@/lib/supabase/access";
import { aiEnabled } from "@/lib/ai/client";
import { el } from "@/lib/i18n/el";
import { AiSpark, ButtonLink, Notice, PageHeader } from "@/components/ui";
import { UploadChooser } from "../UploadChooser";
import { NlEntryForm } from "../../documents/new/NlEntryForm";

// «＋ Καταχώριση»: every way a movement gets into the app, on one screen.
// Files and text stage an ingest batch and land in /inbox/[batchId] for
// review; the manual form writes the movement directly, as it always did.
export default async function NewCapturePage() {
  const supabase = await createClient();
  const [orgId, access] = await Promise.all([getCurrentOrgId(supabase), getAccessContext()]);
  const [{ data: org }, { data: accounts }] = await Promise.all([
    supabase.from("orgs").select("own_afm").eq("id", orgId).maybeSingle(),
    supabase.from("accounts").select("id, name").eq("org_id", orgId).eq("is_active", true).order("sort_order"),
  ]);
  const aiOn = aiEnabled();
  // Why the AI is off (and where it is set up) is for admins; the others
  // simply do not get the text/voice capture.
  const isAdmin = access.kind === "internal" && (access.membership.role === "admin" || access.membership.role === "owner");
  const afmMissing = !org?.own_afm || org.own_afm === "000000000";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link href="/inbox" className="inline-flex min-h-8 items-center hover:text-ink">
            ← {el.nav.inbox}
          </Link>
        }
        title="Καταχώριση"
        meta="Φωτογραφία, αρχείο, κείμενο ή φωνή: το AI ετοιμάζει τις κινήσεις και εσείς τις ελέγχετε πριν καταχωριστούν."
      />

      <section className="flex flex-col gap-4" aria-labelledby="capture-file">
        <h2 id="capture-file" className="flex items-center gap-2 border-b border-hairline pb-3 heading text-section text-ink">
          <Upload className="h-5 w-5 text-muted" strokeWidth={1.5} aria-hidden />
          Φωτογραφία ή αρχείο
        </h2>
        <UploadChooser accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))} aiOn={aiOn} afmMissing={afmMissing} />
      </section>

      {(aiOn || isAdmin) && (
        <section className="flex flex-col gap-4" aria-labelledby="capture-text">
          <h2 id="capture-text" className="flex items-center gap-2 border-b border-hairline pb-3 heading text-section text-ink">
            <MessageSquareText className="h-5 w-5 text-muted" strokeWidth={1.5} aria-hidden />
            Γράψε ή πες
          </h2>
          {aiOn ? (
            <>
              <p className="text-body text-muted">
                Περιγράψτε την κίνηση με δικά σας λόγια ή πατήστε το μικρόφωνο, π.χ. «πλήρωσα 50 € βενζίνη μετρητά για τη
                Λαζαράκη».
              </p>
              <NlEntryForm rows={5} />
            </>
          ) : (
            <Notice tone="warning">
              {el.ingest.aiOffAdmin}{" "}
              <Link href="/settings#ai" className="font-medium text-ink underline underline-offset-4">
                {el.ingest.aiOffLink}
              </Link>
            </Notice>
          )}
        </section>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="capture-manual">
        <h2 id="capture-manual" className="flex items-center gap-2 border-b border-hairline pb-3 heading text-section text-ink">
          <PenLine className="h-5 w-5 text-muted" strokeWidth={1.5} aria-hidden />
          Χειροκίνητα
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-muted">Η φόρμα κίνησης, συμπληρωμένη από εσάς, χωρίς AI.</p>
          <ButtonLink href="/transactions?new=1" variant="secondary">
            Νέα κίνηση
          </ButtonLink>
        </div>
      </section>

      <p className="flex items-start gap-1.5 text-small text-muted">
        <AiSpark className="mt-0.5 shrink-0" />
        <span>
          Για αλλαγές σε λογαριασμούς, έργα, επαφές ή δόσεις χρησιμοποιήστε το{" "}
          <Link href="/assistant" className="underline underline-offset-4 hover:text-ink">
            Kansha AI
          </Link>
          · κάθε πρόταση περνάει από έγκριση στα Εισερχόμενα.
        </span>
      </p>
    </div>
  );
}
