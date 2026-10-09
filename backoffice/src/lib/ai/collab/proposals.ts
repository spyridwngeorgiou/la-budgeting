import { z } from "zod";

// Planner proposals (tasks / milestones) from the board assistant. Same
// shape the approve_collab_proposal() SQL reads: { items: [...] }. Validated
// here before storage; the SQL validates again on approval.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const plannerItemSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2000).optional(),
    start_date: isoDate.optional(),
    due_date: isoDate.optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    kind: z.enum(["general", "permit", "inspection", "handover", "deadline"]).optional(),
  })
  .strict();

export const plannerProposalSchema = z
  .object({
    kind: z.enum(["tasks", "milestones"]),
    items: z.array(plannerItemSchema).min(1).max(30),
    rationale: z.string().trim().max(600).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.items.forEach((item, i) => {
      if (p.kind === "milestones" && !item.due_date) {
        ctx.addIssue({ code: "custom", path: ["items", i, "due_date"], message: "milestones need a due_date" });
      }
      if (item.start_date && item.due_date && item.due_date < item.start_date) {
        ctx.addIssue({ code: "custom", path: ["items", i], message: "due_date is before start_date" });
      }
    });
  });

export type PlannerProposal = z.infer<typeof plannerProposalSchema>;
export type PlannerItem = z.infer<typeof plannerItemSchema>;

// What the panel renders: a stored collab_ai_proposals row, narrowed.
export interface ProposalView {
  id: string;
  kind: "canvas" | "tasks" | "milestones";
  status: "pending" | "approved" | "rejected" | "applied";
  payload: unknown;
  created_at: string;
  thread_id: string | null;
}

export const PROPOSAL_COLUMNS = "id, kind, status, payload, created_at, thread_id" as const;
