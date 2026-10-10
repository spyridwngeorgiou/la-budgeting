import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { Badge, PageHeader, SectionHeader } from "@/components/ui";
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-6 md:px-8 md:py-10">
      <PageHeader eyebrow={project.org_name} title={project.display_name} meta={project.phase || undefined} />

      <ProjectChat
        projectId={projectId}
        orgId={project.org_id}
        meId={access.userId}
        people={peopleMap}
        canUpload={canEdit === true}
        canManage={canManage === true}
        boardTitles={boardTitles}
      />

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-10 lg:col-span-2">
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

        <div className="flex min-w-0 flex-col gap-10">
          <section className="flex flex-col">
            <SectionHeader title={el.collab.people} />
            <ul className="flex flex-col">
              {(people ?? []).map((p) => (
                <li key={`${p.user_id}-${p.is_internal}`} className="flex items-start justify-between gap-2 border-b border-hairline py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{p.display_name || el.collab.unknownUser}</p>
                    <p className="truncate text-small text-muted">
                      {[p.company_name, p.discipline ? el.partner.disciplineValues[p.discipline] : null]
                        .filter(Boolean)
                        .join(" · ")}
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

          <section className="flex flex-col">
            <SectionHeader title={el.collab.activity} />
            {(activity ?? []).length === 0 && <p className="py-3 text-sm text-muted">{el.collab.noActivity}</p>}
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
          </section>
        </div>
      </div>
    </div>
  );
}
