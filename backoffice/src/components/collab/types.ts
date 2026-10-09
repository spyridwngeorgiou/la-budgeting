import type { Tables } from "@/lib/db/types";

// Serializable data the board page (server) hands to the canvas (client).
export type BoardComment = Pick<
  Tables<"board_comments">,
  | "id"
  | "board_id"
  | "parent_id"
  | "element_id"
  | "scene_x"
  | "scene_y"
  | "body"
  | "author_id"
  | "created_at"
  | "resolved_at"
>;

export interface BoardBootstrap {
  boardId: string;
  projectId: string;
  orgId: string;
  title: string;
  canEdit: boolean;
  // Project lead or org editor (0060 can_manage_collab): may delete anyone's
  // comments, files and assistant threads. UI hint only.
  canManage: boolean;
  // Template to build on first open (only sent to the creator, only while
  // the board is still empty); see lib/collab/templates.ts.
  template: string | null;
  hasThumbnail: boolean;
  me: { userId: string; name: string };
  // Excalidraw elements exactly as stored in board_elements.data.
  elements: unknown[];
  comments: BoardComment[];
  // user_id -> display name, from collab_people() (names only, no emails).
  people: Record<string, string>;
  backHref: string;
  // Board assistant rights, or null when AI is disabled (the panel is then
  // hidden). UI hints only: the database enforces every decision.
  ai: { canEdit: boolean; canApproveTasks: boolean; canApproveMilestones: boolean } | null;
}

export const COMMENT_COLUMNS =
  "id, board_id, parent_id, element_id, scene_x, scene_y, body, author_id, created_at, resolved_at" as const;
