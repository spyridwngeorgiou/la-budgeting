import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { Badge, Card } from "@/components/ui";
import { ProjectBoards, type BoardCard } from "@/components/collab/project/ProjectBoards";
import { ProjectFiles } from "@/components/collab/project/ProjectFiles";
import { ProjectChat } from "@/components/collab/project/ProjectChat";

const dateTime = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// One project's collaboration space: the team chat entry, boards as cards
// (with the trash), project files, the people on it and recent activity.
// Everything below is read with the caller's own RLS session; a partner
// without access gets a 404, not an empty page.
export default async function CollabProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const access = await getAccessContext();
  if (access.kind === "anonymous") notFound();

  const [{ data: project }, { data: canEdit }, { data: canManage }] = await Promise.all([
    supabase.rpc("my_collab_projects").eq("project_id", projectId).maybeSingle(),
    supabase.rpc("can_edit_collab", { p_project: projectId }),
    supabase.rpc("can_manage_collab", { p_project: projectId }),
  ]);
  if (!project) notFound();

  const [{ data: boards }, { data: people }, { data: files }, { data: activity }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, title, updated_at, created_by, deleted_at, thumbnail_path")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("collab_people", { p_project: projectId }),
    supabase
      .from("board_files")
      .select("id, original_name, mime_type, size_bytes, created_at, created_by, board_id")
      .eq("project_id", projectId)
      .is("derived_from", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("project_activity")
      .select("id, kind, summary, actor_id, created_at, board_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // Card pictures: short-lived signed URLs, fetched in one round trip.
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
  const boardTitles: Record<string, string> = {};
  for (const b of boards ?? []) boardTitles[b.id] = b.title;

  const peopleMap: Record<string, string> = {};
  for (const p of people ?? []) if (p.display_name) peopleMap[p.user_id] = p.display_name;
  const nameOf = (id: string | null) => (id && peopleMap[id]) || el.collab.unknownUser;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 md:p-6">
      <div>
        <div className="text-xs text-ink-muted">{project.org_name}</div>
        <h1 className="text-xl font-semibold">{project.display_name}</h1>
        {project.phase && <p className="mt-1 text-sm text-ink-muted">{project.phase}</p>}
      </div>

      <ProjectChat
        projectId={projectId}
        orgId={project.org_id}
        meId={access.userId}
        people={peopleMap}
        canUpload={canEdit === true}
        canManage={canManage === true}
        boardTitles={boardTitles}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ProjectBoards
            projectId={projectId}
            boards={cards}
            meId={access.userId}
            canEdit={canEdit === true}
            canManage={canManage === true}
          />
          <ProjectFiles
            projectId={projectId}
            orgId={project.org_id}
            files={files ?? []}
            meId={access.userId}
            canEdit={canEdit === true}
            canManage={canManage === true}
            boardTitles={boardTitles}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink-muted">{el.collab.people}</h2>
            <ul className="flex flex-col gap-2">
              {(people ?? []).map((p) => (
                <li key={`${p.user_id}-${p.is_internal}`} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{p.display_name || el.collab.unknownUser}</div>
                    <div className="truncate text-xs text-ink-muted">
                      {[p.company_name, p.discipline ? el.partner.disciplineValues[p.discipline] : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {p.is_internal ? (
                    <Badge>{el.collab.internalBadge}</Badge>
                  ) : (
                    p.project_role && <Badge tone="green">{el.partner.roleValues[p.project_role]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink-muted">{el.collab.activity}</h2>
            {(activity ?? []).length === 0 && <p className="py-2 text-sm text-ink-faint">{el.collab.noActivity}</p>}
            <ul className="flex flex-col gap-2 text-sm">
              {(activity ?? []).map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{nameOf(a.actor_id)}</span>{" "}
                  <span className="text-ink-muted">{el.collab.activityKinds[a.kind] ?? a.kind}</span>
                  {a.summary && <span className="text-ink"> «{a.summary}»</span>}
                  <div className="text-xs text-ink-faint">{dateTime.format(new Date(a.created_at))}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
