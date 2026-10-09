import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { Badge, Card } from "@/components/ui";

// «Τα έργα μου». Reads projects only through my_collab_projects() --
// whitelisted, non-financial columns -- never the projects table, whose
// rows carry contract and collateral values.
export default async function CollabHomePage() {
  const supabase = await createClient();
  const access = await getAccessContext();
  const { data: projects } = await supabase.rpc("my_collab_projects");
  const list = projects ?? [];

  // A partner on exactly one project has nothing to choose here.
  if (access.kind === "partner" && list.length === 1) redirect(`/collab/${list[0].project_id}`);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{el.collab.myProjects}</h1>
        <p className="mt-1 text-sm text-ink-muted">{el.collab.myProjectsHint}</p>
      </div>

      {list.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">{el.collab.noProjects}</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((p) => (
            <li key={p.project_id}>
              <Link href={`/collab/${p.project_id}`} className="block h-full">
                <Card className="h-full transition-colors hover:border-sage-strong">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.display_name}</div>
                      <div className="truncate text-xs text-ink-muted">
                        {p.org_name}
                        {p.phase ? ` · ${p.phase}` : ""}
                      </div>
                    </div>
                    {p.my_role ? (
                      <Badge tone="green">{el.partner.roleValues[p.my_role]}</Badge>
                    ) : (
                      <Badge>{el.collab.internalBadge}</Badge>
                    )}
                  </div>
                  {p.discipline && (
                    <div className="mt-2 text-xs text-ink-muted">{el.partner.disciplineValues[p.discipline]}</div>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
