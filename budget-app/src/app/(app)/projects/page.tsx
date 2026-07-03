import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro } from "@/lib/utils";
import {
  PROJECT_STATUS_LABEL,
  type Project,
  type Transaction,
} from "@/lib/types";
import { ProjectFormModal } from "./ProjectFormModal";
import { deleteProject } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const [projectsRes, txRes] = await Promise.all([
    supabase.from("projects").select("*").order("created_at"),
    supabase.from("transactions").select("*"),
  ]);
  const projects = (projectsRes.data ?? []) as Project[];
  const transactions = (txRes.data ?? []) as Transaction[];

  const num = (n: number | string) => Number(n) || 0;
  const totalsFor = (projectId: string) => {
    const rows = transactions.filter(
      (t) => t.project_id === projectId && t.type === "expense",
    );
    const paid = rows
      .filter((t) => t.status === "paid")
      .reduce((s, t) => s + num(t.amount), 0);
    const committed = rows
      .filter((t) => t.status !== "planned")
      .reduce((s, t) => s + num(t.amount), 0);
    return { paid, committed };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Έργα</h1>
          <p className="text-sm text-muted">
            Διαχείριση όλων των έργων και των συνόλων τους
          </p>
        </div>
        <ProjectFormModal />
      </div>

      {projects.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          Δεν υπάρχουν έργα ακόμη. Πάτησε «Νέο έργο» για να ξεκινήσεις.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const { paid, committed } = totalsFor(p.id);
            return (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-semibold text-foreground hover:text-primary hover:underline"
                  >
                    {p.name}
                  </Link>
                  <Badge tone={p.status}>
                    {PROJECT_STATUS_LABEL[p.status]}
                  </Badge>
                </div>
                {p.description && (
                  <p className="mb-3 line-clamp-2 text-sm text-muted">
                    {p.description}
                  </p>
                )}
                <div className="mt-auto space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Πληρωμένα</span>
                    <span className="font-medium">{formatEuro(paid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Δεσμευμένα</span>
                    <span className="font-semibold text-primary">
                      {formatEuro(committed)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <ProjectFormModal project={p} />
                  <DeleteButton
                    action={deleteProject}
                    id={p.id}
                    confirmText="Διαγραφή έργου; Οι κινήσεις θα παραμείνουν χωρίς έργο."
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
