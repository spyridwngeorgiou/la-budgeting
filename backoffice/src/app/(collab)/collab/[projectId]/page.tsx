import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { Badge, Card, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createBoard, archiveBoard } from "./actions";

const dateTime = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// One project's collaboration space: boards, the people on it, files and
// recent activity. Everything below is read with the caller's own RLS
// session; a partner without access gets a 404, not an empty page.
export default async function CollabProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: canEdit }] = await Promise.all([
    supabase.rpc("my_collab_projects").eq("project_id", projectId).maybeSingle(),
    supabase.rpc("can_edit_collab", { p_project: projectId }),
  ]);
  if (!project) notFound();

  const [{ data: boards }, { data: people }, { data: files }, { data: activity }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, title, updated_at")
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false }),
    supabase.rpc("collab_people", { p_project: projectId }),
    supabase
      .from("board_files")
      .select("id, original_name, mime_type, size_bytes, created_at, board_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("project_activity")
      .select("id, kind, summary, actor_id, created_at, board_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const nameOf = (id: string | null) =>
    (id && (people ?? []).find((p) => p.user_id === id)?.display_name) || el.collab.unknownUser;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <div className="text-xs text-ink-muted">{project.org_name}</div>
        <h1 className="text-xl font-semibold">{project.display_name}</h1>
        {project.phase && <p className="mt-1 text-sm text-ink-muted">{project.phase}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">{el.collab.boards}</h2>
          {(boards ?? []).length === 0 && <p className="py-2 text-sm text-ink-faint">{el.collab.noBoards}</p>}
          <ul className="flex flex-col">
            {(boards ?? []).map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 border-t border-line/60 py-2 first:border-0 first:pt-0"
              >
                <Link href={`/collab/${projectId}/board/${b.id}`} className="min-w-0 flex-1 hover:underline">
                  <div className="truncate text-sm font-medium">{b.title}</div>
                  <div className="text-xs text-ink-faint">{dateTime.format(new Date(b.updated_at))}</div>
                </Link>
                {canEdit && (
                  <form action={archiveBoard.bind(null, projectId, b.id)}>
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                      {el.collab.archive}
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              action={createBoard.bind(null, projectId)}
              className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row"
            >
              <Input
                name="title"
                placeholder={el.collab.boardTitle}
                maxLength={200}
                required
                className="min-w-0 flex-1"
              />
              <SubmitButton>{el.collab.newBoard}</SubmitButton>
            </form>
          )}
        </Card>

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

        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">{el.collab.files}</h2>
          {(files ?? []).length === 0 && <p className="py-2 text-sm text-ink-faint">{el.collab.noFiles}</p>}
          <ul className="flex flex-col">
            {(files ?? []).map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 border-t border-line/60 py-2 text-sm first:border-0 first:pt-0"
              >
                <a
                  href={`/collab/${projectId}/files/${f.id}`}
                  target="_blank"
                  rel="noopener"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {f.original_name || f.mime_type}
                </a>
                <span className="shrink-0 text-xs text-ink-faint">
                  {formatSize(f.size_bytes)} · {formatDate(f.created_at)}
                </span>
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
  );
}
