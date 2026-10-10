import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { Badge, EmptyState, MetaList, PageHeader } from "@/components/ui";

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
      <PageHeader title={el.collab.myProjects} meta={el.collab.myProjectsHint} />

      {list.length === 0 ? (
        <EmptyState title={el.collab.noProjects} />
      ) : (
        <ul className="flex flex-col border-t border-hairline">
          {list.map((p) => (
            <li key={p.project_id} className="border-b border-hairline">
              <Link
                href={`/collab/${p.project_id}`}
                className="group flex min-h-16 items-start justify-between gap-4 px-1 py-3 transition-colors hover:bg-hover"
              >
                <div className="min-w-0">
                  <p className="truncate text-body text-ink group-hover:underline group-hover:underline-offset-4">{p.display_name}</p>
                  <MetaList
                    className="truncate"
                    items={[p.org_name, p.phase, p.discipline ? el.partner.disciplineValues[p.discipline] : null]}
                  />
                </div>
                {p.my_role ? (
                  <Badge tone="positive">{el.partner.roleValues[p.my_role]}</Badge>
                ) : (
                  <Badge>{el.collab.internalBadge}</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
