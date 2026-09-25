"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Input } from "@/components/ui";
import type { ProjectStatus } from "@/lib/domain/enums";

const STATUS_TONE = {
  offer: "neutral",
  active: "green",
  on_hold: "amber",
  completed: "neutral",
  cancelled: "red",
} as const;

interface ProjectRow {
  project_id: string | null;
  display_name: string | null;
  status: string | null;
  total_budget: number | null;
  spent: number | null;
  pending: number | null;
  vat_on_expenses: number | null;
}

function normalize(s: string) {
  return s.toLocaleLowerCase("el");
}

export function ProjectsGrid({
  rollup,
  noBudgetIds = [],
}: {
  rollup: ProjectRow[];
  noBudgetIds?: string[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const noBudget = new Set(noBudgetIds);

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    return rollup.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (q && !normalize(p.display_name ?? "").includes(q)) return false;
      return true;
    });
  }, [rollup, search, statusFilter]);

  const statuses = [...new Set(rollup.map((p) => p.status).filter(Boolean))] as string[];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Αναζήτηση έργου…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1 text-sm">
          <button
            onClick={() => setStatusFilter("")}
            className={`rounded px-3 py-1 ${!statusFilter ? "bg-ink text-white" : "bg-bg text-ink-muted"}`}
          >
            Όλα
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded px-3 py-1 ${statusFilter === s ? "bg-ink text-white" : "bg-bg text-ink-muted"}`}
            >
              {el.project.statusValues[s as ProjectStatus]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          {rollup.length === 0
            ? "Δεν υπάρχουν ακόμα έργα. Πατήστε «+ Νέο Έργο» για να ξεκινήσετε."
            : "Κανένα έργο δεν ταιριάζει με τα φίλτρα."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <Link
              key={p.project_id}
              href={`/projects/${p.project_id}`}
              className="group rounded-lg border border-line p-4 transition-colors hover:border-line-strong hover:bg-surface"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium">{p.display_name}</span>
                {p.status && (
                  <Badge tone={STATUS_TONE[p.status as ProjectStatus]}>
                    {el.project.statusValues[p.status as ProjectStatus]}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat
                  label={el.project.budget}
                  value={p.project_id && noBudget.has(p.project_id) ? "—" : formatMoney(p.total_budget)}
                />
                <Stat label={el.project.spent} value={formatMoney(p.spent)} />
                <Stat label={el.project.pending} value={formatMoney(p.pending)} />
                <Stat label="+ ΦΠΑ" value={formatMoney(p.vat_on_expenses)} />
              </div>
              {p.project_id && noBudget.has(p.project_id) && (
                <div className="mt-2">
                  <Badge tone="amber">Χωρίς προϋπολογισμό</Badge>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-xs text-ink-muted">
                <span>Στοιχεία έργου, δάνεια, μίσθωση, σημειώσεις…</span>
                <span className="text-ink-faint transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
