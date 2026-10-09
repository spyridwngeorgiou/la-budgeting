"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";

// Decisions on the board assistant's proposals. Authorization is entirely
// in the database, under the caller's own RLS:
//   - approve_collab_proposal() (SECURITY INVOKER) lets only a project lead
//     (tasks) or an org editor (tasks, milestones) approve, and inserts the
//     planner rows into the proposal's own project.
//   - collab_ai_proposals_guard lets a status move once: canvas proposals to
//     applied/rejected by anyone who may edit the board, planner proposals to
//     rejected by a lead or editor.
// Nothing here takes a project id from the client.

export type ProposalActionResult = { ok: true } | { ok: false; error: string };

const id = z.uuid();

function failure(message: string | undefined): ProposalActionResult {
  // Permission errors come back from SQL in English; show a Greek message.
  return { ok: false, error: message && /lead|editor|allowed|42501/i.test(message) ? el.collabAi.proposal.needsLead : el.collabAi.error.saveFailed };
}

export async function approveCollabProposal(proposalId: string, indexes?: number[]): Promise<ProposalActionResult> {
  if (!id.safeParse(proposalId).success) return { ok: false, error: el.collabAi.error.badRequest };
  const idx = z.array(z.number().int().min(0).max(49)).max(50).optional().safeParse(indexes);
  if (!idx.success) return { ok: false, error: el.collabAi.error.badRequest };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_collab_proposal", {
    p_proposal: proposalId,
    ...(idx.data && idx.data.length > 0 ? { p_indexes: idx.data } : {}),
  });
  if (error) return failure(error.message);
  return { ok: true };
}

async function setStatus(proposalId: string, status: "rejected" | "applied"): Promise<ProposalActionResult> {
  if (!id.safeParse(proposalId).success) return { ok: false, error: el.collabAi.error.badRequest };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collab_ai_proposals")
    .update({ status })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id");
  if (error) return failure(error.message);
  if (!data || data.length === 0) return { ok: false, error: el.collabAi.error.saveFailed };
  return { ok: true };
}

export async function rejectCollabProposal(proposalId: string): Promise<ProposalActionResult> {
  return setStatus(proposalId, "rejected");
}

// Called after the user placed a canvas proposal on the board; the elements
// themselves were saved by the normal board sync (upsert_board_elements).
export async function markCanvasProposalApplied(proposalId: string): Promise<ProposalActionResult> {
  return setStatus(proposalId, "applied");
}
