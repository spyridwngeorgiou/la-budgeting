import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { orgCategoryNames, stageAiDocument } from "./aiDocument";
import { stageAiText } from "./aiText";

// An inbound email (ai_email) -> staged batches: one per supported
// attachment, or one for the body text when there is none. Called by the
// webhook with the service-role client, so orgId (from
// email_inbound_addresses) is passed explicitly to every write and lookup.
// A failing attachment is logged on its document_jobs row and skipped:
// the mail provider must still get a 200.

type Client = SupabaseClient<Database>;

export const EMAIL_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export interface InboundEmail {
  from: string | null;
  subject: string | null;
  text: string | null;
  attachments: { name: string; mimeType: string; base64: string }[];
}

export async function stageInboundEmail(admin: Client, orgId: string, email: InboundEmail): Promise<string[]> {
  const categoryNames = await orgCategoryNames(admin, orgId);
  const meta = { email_from: email.from, email_subject: email.subject };
  const attachments = email.attachments.filter((a) => EMAIL_ATTACHMENT_MIME_TYPES.has(a.mimeType));
  const batchIds: string[] = [];

  if (attachments.length > 0) {
    for (const attachment of attachments) {
      try {
        const { batchId } = await stageAiDocument(admin, {
          orgId,
          userId: null,
          source: "ai_email",
          file: { name: attachment.name, mimeType: attachment.mimeType, bytes: new Uint8Array(Buffer.from(attachment.base64, "base64")) },
          categoryNames,
          usageFeature: "email_document_extraction",
          meta,
        });
        batchIds.push(batchId);
      } catch (e) {
        console.error("[email] attachment skipped", e instanceof Error ? e.message : e);
      }
    }
    return batchIds;
  }

  const text = (email.text ?? "").trim() || (email.subject ?? "").trim();
  if (!text) return batchIds;
  const { batchId } = await stageAiText(admin, {
    orgId,
    userId: null,
    source: "ai_email",
    text,
    label: "Email",
    usageFeature: "email_nl_entry",
    categoryNames,
    filename: email.subject,
    meta,
  });
  batchIds.push(batchId);
  return batchIds;
}
