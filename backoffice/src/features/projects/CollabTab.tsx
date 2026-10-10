import { Badge, EmptyState, SectionHeader } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import { getAccessContext } from "@/lib/supabase/access";
import { ProjectBoards, type BoardCard } from "@/components/collab/project/ProjectBoards";
import { ProjectFiles } from "@/components/collab/project/ProjectFiles";
import { ProjectChat } from "@/components/collab/project/ProjectChat";
import { PartnersPanel } from "@/app/(app)/projects/[id]/PartnersPanel";
import { requireTab } from "./data";

const t = projects.collab;
const dateTime = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Συνεργασία: the project's collaboration space inside the project -- team
// chat, boards (the Excalidraw canvas opens at /collab/[id]/board/[boardId]
// as before), files, the people on it, recent activity, and «Συνεργάτες»
// (invites and roles, moved here from the bottom of the one-pager). Same
// reads as /collab/[projectId], with the caller's own RLS.
export async function CollabTab({ id }: { id: string }) {
  const core = await requireTab(id, "collab");
  const { supabase } = core;
  const access = await getAccessContext();
  if (access.kind === "anonymous") return null;

  const [{ data: project }, { data: canEdit }, { data: canManage }] = await Promise.all([
    supabase.rpc("my_collab_projects").eq("project_id", id).maybeSingle(),
    supabase.rpc("can_edit_collab", { p_project: id }),
    supabase.rpc("can_manage_collab", { p_project: id }),
  ]);
  if (!project) return <EmptyState title={t.noAccess} />;

  const [{ data: boards }, { data: people }, { data: files }, { data: activity }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, title, updated_at, created_by, deleted_at, thumbnail_path")
      .eq("project_id", id)
      .order("updated_at", { ascending: false }),
    supabase.rpc("collab_people", { p_project: id }),
    supabase
      .from("board_files")
      .select("id, original_name, mime_type, size_bytes, created_at, created_by, board_id")
      .eq("project_id", id)
      .is("derived_from", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("project_activity")
      .select("id, kind, summary, actor_id, created_at, board_id")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const withThumb = (boards ?? []).filter((b) => !b.deleted_at && b.thumbnail_path);
  const { data: signed } = withThumb.length
    ? await supabase.storage.from("collab").createSignedUrls(
        withThumb.map((b) => b.thumbnail_path as string),
        600,
      )
    : { data: [] };
  const thumbs = new Map<string, string>();
  withThumb.forEach((b, i) => {
    const url = signed?.[i]?.signedUrl;
    if (url) thumbs.set(b.id, url);
  });
  const cards: BoardCard[] = (boards ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    updated_at: b.updated_at,
    created_by: b.created_by,
    deleted_at: b.deleted_at,
    thumbnailUrl: thumbs.get(b.id) ?? null,
  }));
  const boardTitles: Record<string, string> = Object.fromEntries((boards ?? []).map((b) => [b.id, b.title]));
  const peopleMap: Record<string, string> = {};
  for (const p of people ?? []) if (p.display_name) peopleMap[p.user_id] = p.display_name;
  const nameOf = (uid: string | null) => (uid && peopleMap[uid]) || el.collab.unknownUser;
  const editable = canEdit === true;
  const manageable = canManage === true;

  return (
    <div className="flex flex-col gap-12">
      <ProjectChat
        projectId={id}
        orgId={project.org_id}
        meId={access.userId}
        people={peopleMap}
        canUpload={editable}
        canManage={manageable}
        boardTitles={boardTitles}
      />

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-3">
        <div className="flex flex-col gap-10 lg:col-span-2">
          <ProjectBoards projectId={id} boards={cards} meId={access.userId} canEdit={editable} canManage={manageable} />
          <ProjectFiles
            projectId={id}
            orgId={project.org_id}
            files={files ?? []}
            meId={access.userId}
            canEdit={editable}
            canManage={manageable}
            boardTitles={boardTitles}
          />
        </div>

        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <SectionHeader as="h3" title={t.people} />
            <ul className="flex flex-col">
              {(people ?? []).map((p) => (
                <li key={`${p.user_id}-${p.is_internal}`} className="flex items-start justify-between gap-2 border-b border-hairline py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{p.display_name || el.collab.unknownUser}</p>
                    <p className="truncate text-small text-muted">
                      {[p.company_name, p.discipline ? el.partner.disciplineValues[p.discipline] : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {p.is_internal ? (
                    <Badge>{el.collab.internalBadge}</Badge>
                  ) : (
                    p.project_role && <Badge tone="positive">{el.partner.roleValues[p.project_role]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader as="h3" title={t.activity} />
            {(activity ?? []).length === 0 ? (
              <p className="text-sm text-muted">{el.collab.noActivity}</p>
            ) : (
              <ul className="flex flex-col">
                {(activity ?? []).map((a) => (
                  <li key={a.id} className="border-b border-hairline py-2.5 text-sm">
                    <span className="text-ink">{nameOf(a.actor_id)}</span>{" "}
                    <span className="text-muted">{el.collab.activityKinds[a.kind] ?? a.kind}</span>
                    {a.summary && <span className="text-ink"> «{a.summary}»</span>}
                    <span className="num block text-small text-muted">{dateTime.format(new Date(a.created_at))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Its own heading («Συνεργάτες έργου»); restyled with the planner
          and collab pieces in Phase 6. */}
      {core.role !== "partner" && <PartnersPanel projectId={id} isAdmin={core.isAdmin} />}
    </div>
  );
}
