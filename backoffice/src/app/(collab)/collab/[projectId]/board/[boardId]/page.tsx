import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { aiEnabled } from "@/lib/ai/client";
import { BoardLoader } from "@/components/collab/BoardLoader";
import { COMMENT_COLUMNS, type BoardBootstrap } from "@/components/collab/types";

// The canvas page. Server side it only gathers the initial scene and the
// caller's rights; all live behaviour (including the header with the
// «Συζήτηση» button) is in BoardCanvas (client-only). Tombstoned elements
// aren't sent: the server is the authority on merges, and any stale copy a
// client still holds loses in upsert_board_elements. Boards in the trash
// (0060) are not openable.
export default async function BoardPage({ params }: { params: Promise<{ projectId: string; boardId: string }> }) {
  const { projectId, boardId } = await params;
  const supabase = await createClient();
  const access = await getAccessContext();
  if (access.kind === "anonymous") notFound();

  const { data: board } = await supabase
    .from("boards")
    .select("id, title, org_id, project_id, created_by, template, thumbnail_path")
    .eq("id", boardId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!board) notFound();

  const [
    { data: canEdit },
    { data: canManage },
    { data: elements },
    { data: comments },
    { data: people },
    { data: myMembership },
  ] = await Promise.all([
    supabase.rpc("can_edit_collab", { p_project: projectId }),
    supabase.rpc("can_manage_collab", { p_project: projectId }),
    supabase.from("board_elements").select("data").eq("board_id", boardId).eq("is_deleted", false),
    supabase.from("board_comments").select(COMMENT_COLUMNS).eq("board_id", boardId).order("created_at"),
    supabase.rpc("collab_people", { p_project: projectId }),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", access.userId).maybeSingle(),
  ]);

  // Who may decide planner proposals -- mirrors approve_collab_proposal()
  // (lead: tasks; org editor and up: tasks and milestones). Only decides
  // which buttons show; the database enforces it.
  const isOrgEditor =
    access.kind === "internal" &&
    access.membership.orgId === board.org_id &&
    ["editor", "admin", "owner"].includes(access.membership.role);
  const isLead = myMembership?.role === "lead";

  const peopleMap: Record<string, string> = {};
  for (const p of people ?? []) {
    if (p.display_name) peopleMap[p.user_id] = p.display_name;
  }
  // Shown to peers via presence: a profile name or nothing -- never derived
  // from the email address.
  const myName = peopleMap[access.userId] ?? el.collab.unknownUser;
  const sceneElements = (elements ?? []).map((e) => e.data);

  const bootstrap: BoardBootstrap = {
    boardId,
    projectId,
    orgId: board.org_id,
    title: board.title,
    canEdit: canEdit === true,
    canManage: canManage === true,
    template: board.template && board.created_by === access.userId && sceneElements.length === 0 ? board.template : null,
    hasThumbnail: board.thumbnail_path !== null,
    me: { userId: access.userId, name: myName },
    elements: sceneElements,
    comments: comments ?? [],
    people: { ...peopleMap, [access.userId]: myName },
    backHref: `/collab/${projectId}`,
    ai: aiEnabled()
      ? { canEdit: canEdit === true, canApproveTasks: isOrgEditor || isLead, canApproveMilestones: isOrgEditor }
      : null,
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <BoardLoader bootstrap={bootstrap} />
    </div>
  );
}
