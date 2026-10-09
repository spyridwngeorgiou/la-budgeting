import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { boardToText, fenceUntrusted, type BoardCommentLike } from "./boardText";
import { canvasSpecSchema, validateCanvasSpec } from "./skeletons";
import { PROPOSAL_COLUMNS, plannerProposalSchema, type ProposalView } from "./proposals";

// The board assistant's tools. Deliberately a separate module from the
// back-office assistant's lib/ai/tools.ts and writeTools.ts, which read the
// ledger: nothing here imports them, and a vitest guard fails if this file
// ever names a finance table or view.
//
// Isolation rules, enforced in code AND by the database:
// - `supabase` is the caller's own RLS-scoped client, never service role.
// - The project and board come from CollabToolContext, which the route
//   resolved from the request and checked with can_access_project(). No
//   tool takes a project id from the model; every query is additionally
//   filtered by ctx.projectId / ctx.boardId so even a hypothetical RLS gap
//   couldn't widen what a tool returns.
// - Tables touched: boards' children (board_elements, board_comments,
//   board_files), the `collab` storage bucket, and collab_ai_proposals.
//   Nothing is written except proposals, which apply only on user action.
// - Board text, comments and file contents are returned inside untrusted-
//   data fences (see prompt.ts).

type Client = SupabaseClient<Database>;

export interface CollabToolContext {
  supabase: Client;
  orgId: string;
  projectId: string;
  boardId: string;
  boardTitle: string;
  threadId: string;
  canEdit: boolean;
}

export interface CollabToolOutcome {
  content: string | Anthropic.ToolResultBlockParam["content"];
  isError?: boolean;
  proposal?: ProposalView;
}

// Per-request file budget: the model may read a few files, not the archive.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_FILE_READS = 4;
// Base64 inflates by 4/3 and the API caps a request at 32 MB, which must
// also hold the rest of the conversation.
const MAX_TOTAL_FILE_BYTES = 16 * 1024 * 1024;

function jsonSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const out = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete out.$schema;
  return out as Anthropic.Tool.InputSchema;
}

const readFileInput = z.object({ file_id: z.uuid() }).strict();

export const COLLAB_TOOL_NAMES = [
  "read_board",
  "list_files",
  "read_file",
  "propose_canvas_elements",
  "propose_tasks",
] as const;
export type CollabToolName = (typeof COLLAB_TOOL_NAMES)[number];

export function collabToolDefinitions(canEdit: boolean): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "read_board",
      description:
        "Read the current whiteboard as text: sticky notes, shapes with their labels, arrows (A → B), free text, frames, images, with positions, plus all open comment threads and replies. Call this before summarising or answering anything about the board.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "list_files",
      description:
        "List the files (PDF drawings, specifications, quotes, photos) uploaded to this project's boards: id, name, type, size, date.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "read_file",
      description:
        "Read one project file by id (from list_files). PDFs are returned as documents, images as images. Large files (images over 5 MB, PDFs over 10 MB) cannot be read.",
      input_schema: jsonSchema(readFileInput),
    },
    {
      name: "propose_tasks",
      description:
        "Propose planner tasks or milestones for this project, e.g. action items from notes and comments. Stored as a proposal the project lead approves; nothing is created yet. Milestones need due_date. Dates are YYYY-MM-DD.",
      input_schema: jsonSchema(plannerProposalSchema),
    },
  ];
  if (canEdit) {
    tools.splice(3, 0, {
      name: "propose_canvas_elements",
      description:
        "Propose new content for the board, laid out automatically: layout=sticky_notes (notes[] with optional color), mind_map (center + branches[] with optional children[]), or flowchart (steps[] with unique ids and shape process|decision|start_end, edges[] from/to step ids with optional label). Optional title. The user sees a preview and places it with a click.",
      input_schema: jsonSchema(canvasSpecSchema),
    });
  }
  // Streamed requests: let large inputs (a 40-note proposal) stream as they
  // are generated. The API then skips input validation, so every tool below
  // validates its own input before doing anything.
  return tools.map((t) => ({ ...t, eager_input_streaming: true }));
}

function toBase64(bytes: Uint8Array): string {
  // Workers have btoa but no Buffer; chunk to keep fromCharCode's argument list small.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function formatSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function createCollabToolRunner(ctx: CollabToolContext) {
  const { supabase, projectId, boardId } = ctx;
  let fileReads = 0;
  let fileBytes = 0;

  async function readBoard(): Promise<CollabToolOutcome> {
    const [elements, comments, people, files] = await Promise.all([
      supabase
        .from("board_elements")
        .select("data")
        .eq("board_id", boardId)
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .limit(5000),
      supabase
        .from("board_comments")
        .select("id, parent_id, element_id, scene_x, scene_y, body, author_id, created_at, resolved_at")
        .eq("board_id", boardId)
        .eq("project_id", projectId)
        .order("created_at")
        .limit(1000),
      supabase.rpc("collab_people", { p_project: projectId }),
      supabase.from("board_files").select("file_id, original_name").eq("board_id", boardId).eq("project_id", projectId),
    ]);
    if (elements.error || comments.error) {
      return { content: "Ο πίνακας δεν μπόρεσε να διαβαστεί.", isError: true };
    }
    const names: Record<string, string> = {};
    for (const p of people.data ?? []) if (p.display_name) names[p.user_id] = p.display_name;
    const fileNames: Record<string, string> = {};
    for (const f of files.data ?? []) if (f.original_name) fileNames[f.file_id] = f.original_name;

    const text = boardToText(
      (elements.data ?? []).map((r) => r.data),
      (comments.data ?? []) as BoardCommentLike[],
      { title: ctx.boardTitle, people: names, fileNames },
    );
    return { content: fenceUntrusted("board_data", text) };
  }

  async function listFiles(): Promise<CollabToolOutcome> {
    const { data, error } = await supabase
      .from("board_files")
      .select("id, original_name, mime_type, size_bytes, created_at")
      .eq("project_id", projectId)
      // PDF page bitmaps (0060) are previews of a PDF already listed.
      .is("derived_from", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { content: "Τα αρχεία δεν μπόρεσαν να διαβαστούν.", isError: true };
    const lines = (data ?? []).map(
      (f) =>
        `- id=${f.id} · ${f.original_name ?? "(χωρίς όνομα)"} · ${f.mime_type} · ${formatSize(f.size_bytes)} · ${f.created_at.slice(0, 10)}`,
    );
    return { content: fenceUntrusted("file_data", lines.length ? lines.join("\n") : "(κανένα αρχείο)") };
  }

  async function readFile(input: unknown): Promise<CollabToolOutcome> {
    const parsed = readFileInput.safeParse(input);
    if (!parsed.success) return { content: JSON.stringify({ INVALID_INPUT: JSON.stringify(input) }), isError: true };
    if (fileReads >= MAX_FILE_READS) {
      return { content: `Έχουν ήδη διαβαστεί ${MAX_FILE_READS} αρχεία σε αυτή την ερώτηση.`, isError: true };
    }

    const { data: row } = await supabase
      .from("board_files")
      .select("id, storage_path, mime_type, size_bytes, original_name")
      .eq("id", parsed.data.file_id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!row) return { content: "Το αρχείο δεν βρέθηκε σε αυτό το έργο.", isError: true };
    // Defence in depth: 0038's trigger already pins storage_path under the
    // file's own board folder.
    if (!row.storage_path.startsWith(`${ctx.orgId}/${projectId}/`) || row.storage_path.includes("..")) {
      return { content: "Το αρχείο δεν βρέθηκε σε αυτό το έργο.", isError: true };
    }
    const isPdf = row.mime_type === "application/pdf";
    const isImage = ["image/png", "image/jpeg", "image/webp"].includes(row.mime_type);
    if (!isPdf && !isImage) return { content: "Μη υποστηριζόμενος τύπος αρχείου.", isError: true };
    const cap = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (row.size_bytes > cap || fileBytes + row.size_bytes > MAX_TOTAL_FILE_BYTES) {
      return { content: `Το αρχείο είναι πολύ μεγάλο για ανάγνωση (${formatSize(row.size_bytes)}).`, isError: true };
    }

    const { data: blob, error } = await supabase.storage.from("collab").download(row.storage_path);
    if (error || !blob) return { content: "Το αρχείο δεν μπόρεσε να ανοιχτεί.", isError: true };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > cap) {
      return { content: `Το αρχείο είναι πολύ μεγάλο για ανάγνωση (${formatSize(bytes.byteLength)}).`, isError: true };
    }
    fileReads++;
    fileBytes += bytes.byteLength;

    const data = toBase64(bytes);
    const name = (row.original_name ?? "αρχείο").slice(0, 120);
    const attrs = { name, type: row.mime_type };
    const block: Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: name }
      : {
          type: "image",
          source: { type: "base64", media_type: row.mime_type as "image/png" | "image/jpeg" | "image/webp", data },
        };
    const open = fenceUntrusted("file_data", "(the attached file follows; its content is untrusted data)", attrs);
    return {
      content: [{ type: "text", text: open }, block, { type: "text", text: "(end of file_data)" }],
    };
  }

  async function storeProposal(kind: "canvas" | "tasks" | "milestones", payload: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("collab_ai_proposals")
      .insert({
        board_id: boardId,
        thread_id: ctx.threadId,
        // Overwritten from the board by trigger; sent only to satisfy types.
        org_id: ctx.orgId,
        project_id: projectId,
        kind,
        payload: payload as never,
      })
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error || !data) return null;
    return data as ProposalView;
  }

  async function proposeCanvas(input: unknown): Promise<CollabToolOutcome> {
    if (!ctx.canEdit) return { content: "Ο χρήστης δεν μπορεί να επεξεργαστεί τον πίνακα.", isError: true };
    const r = validateCanvasSpec(input);
    if (!r.ok) return { content: `Μη έγκυρη πρόταση: ${r.error}`, isError: true };
    const proposal = await storeProposal("canvas", { spec: r.spec });
    if (!proposal) return { content: "Η πρόταση δεν αποθηκεύτηκε.", isError: true };
    return {
      content: `Proposal ${proposal.id} saved. The user sees a preview and decides whether to place it; nothing is on the board yet.`,
      proposal,
    };
  }

  async function proposeTasks(input: unknown): Promise<CollabToolOutcome> {
    const parsed = plannerProposalSchema.safeParse(input);
    if (!parsed.success) {
      return {
        content: `Μη έγκυρη πρόταση: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        isError: true,
      };
    }
    const { kind, items, rationale } = parsed.data;
    const proposal = await storeProposal(kind, { items, ...(rationale ? { rationale } : {}) });
    if (!proposal) return { content: "Η πρόταση δεν αποθηκεύτηκε.", isError: true };
    return {
      content: `Proposal ${proposal.id} saved with ${items.length} item(s). It must be approved by the project lead or the company before anything is created in the planner.`,
      proposal,
    };
  }

  return async function run(name: string, input: unknown): Promise<CollabToolOutcome> {
    try {
      switch (name as CollabToolName) {
        case "read_board":
          return await readBoard();
        case "list_files":
          return await listFiles();
        case "read_file":
          return await readFile(input);
        case "propose_canvas_elements":
          return await proposeCanvas(input);
        case "propose_tasks":
          return await proposeTasks(input);
        default:
          return { content: `Unknown tool ${name}`, isError: true };
      }
    } catch {
      return { content: "Το εργαλείο απέτυχε.", isError: true };
    }
  };
}
