"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Input, StatusDot, cn } from "@/components/ui";
import type { ProjectStatus } from "@/lib/domain/enums";

const STATUS_TONE = {
  offer: "neutral",
  active: "positive",
  on_hold: "warning",
  completed: "neutral",
  cancelled: "negative",
} as const;

// The status filter: the app's one chip style (ui/Toolbar FilterChip), as
// buttons because the filter is local state here.
const CHIP = "inline-flex min-h-9 items-center border px-3 py-1 text-small whitespace-nowrap transition-colors max-md:min-h-11";
const CHIP_ON = "border-navy bg-navy text-panel-ink";
const CHIP_OFF = "border-chip-border text-text hover:border-navy hover:text-ink";

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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Αναζήτηση έργου…"
          aria-label="Αναζήτηση έργου"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs max-md:min-h-11"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label={el.project.status}>
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            aria-pressed={!statusFilter}
            className={cn(CHIP, !statusFilter ? CHIP_ON : CHIP_OFF)}
          >
            Όλα
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={cn(CHIP, statusFilter === s ? CHIP_ON : CHIP_OFF)}
            >
              {el.project.statusValues[s as ProjectStatus]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">
          {rollup.length === 0
            ? "Δεν υπάρχουν ακόμα έργα. Πατήστε «+ Νέο Έργο» για να ξεκινήσετε."
            : "Κανένα έργο δεν ταιριάζει με τα φίλτρα."}
        </p>
      ) : (
        // No cards: each project is a block under a hairline that turns
        // navy on hover, its figures light and tabular.
        <ul className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.project_id} className="min-w-0">
              <Link
                href={`/projects/${p.project_id}`}
                className="group flex h-full flex-col gap-4 border-t border-hairline pt-4 transition-colors hover:border-navy"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-section font-normal break-words text-ink group-hover:underline group-hover:underline-offset-4">
                    {p.display_name}
                  </span>
                  {p.status && (
                    <StatusDot
                      tone={STATUS_TONE[p.status as ProjectStatus]}
                      label={el.project.statusValues[p.status as ProjectStatus]}
                      className="shrink-0 pt-1.5"
                    />
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Figure
                    label={el.project.budget}
                    value={p.project_id && noBudget.has(p.project_id) ? "—" : formatMoney(p.total_budget)}
                  />
                  <Figure label={el.project.spent} value={formatMoney(p.spent)} />
                  <Figure label={el.project.pending} value={formatMoney(p.pending)} />
                  <Figure label="+ ΦΠΑ" value={formatMoney(p.vat_on_expenses)} />
                </dl>
                {p.project_id && noBudget.has(p.project_id) && (
                  <div>
                    <Badge tone="warning">Χωρίς προϋπολογισμό</Badge>
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline pt-2 text-small text-muted">
                  <span>Στοιχεία έργου, δάνεια, μίσθωση, σημειώσεις…</span>
                  <span aria-hidden="true" className="text-ink transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="eyebrow text-muted">{label}</dt>
      <dd className="num text-lead font-light text-ink">{value}</dd>
    </div>
  );
}
