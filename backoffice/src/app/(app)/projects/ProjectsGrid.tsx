"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney, formatPercent } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Input, StatusDot, cn } from "@/components/ui";
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

// One card: the project page's ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ figures (projects/page.tsx
// maps them from v_project_rollup).
export interface ProjectCard {
  id: string;
  name: string;
  status: string | null;
  // null: no budget on file («—»).
  budget: number | null;
  paid: number;
  committed: number;
  remaining: number;
}

function normalize(s: string) {
  return s.toLocaleLowerCase("el");
}

export function ProjectsGrid({ projects }: { projects: ProjectCard[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const b = el.projectPage.budget;

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    return projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (q && !normalize(p.name).includes(q)) return false;
      return true;
    });
  }, [projects, search, statusFilter]);

  const statuses = [...new Set(projects.map((p) => p.status).filter(Boolean))] as string[];

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
          {projects.length === 0 ? el.projectPage.list.empty : el.projectPage.list.noMatch}
        </p>
      ) : (
        // No cards: each project is a block under a hairline that turns
        // navy on hover, its figures light and tabular.
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link
                href={`/projects/${p.id}`}
                className="group flex h-full flex-col gap-4 border-t border-hairline pt-4 transition-colors hover:border-navy"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="heading min-w-0 text-section break-words text-ink group-hover:underline group-hover:underline-offset-4">
                    {p.name}
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
                  <Figure label={b.budget} value={p.budget == null ? "—" : formatMoney(p.budget)} />
                  <Figure label={b.paid} value={formatMoney(p.paid)} />
                  <Figure label={b.committed} value={formatMoney(p.committed)} />
                  <Figure
                    label={b.remaining}
                    value={p.budget == null ? "—" : formatMoney(p.remaining)}
                    negative={p.budget != null && p.remaining < 0}
                  />
                </dl>
                {p.budget != null && p.budget > 0 && <SpendLine budget={p.budget} paid={p.paid} committed={p.committed} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="eyebrow text-muted">{label}</dt>
      <dd className={cn("num text-lead font-light", negative ? "text-negative" : "text-ink")}>{value}</dd>
    </div>
  );
}

// How much of the budget the capex has consumed: a thin line, paid in navy
// and committed after it in the accent, the whole line negative once over
// budget; the share beside it.
function SpendLine({ budget, paid, committed }: { budget: number; paid: number; committed: number }) {
  const share = (paid + committed) / budget;
  const over = share > 1;
  const paidWidth = Math.max(0, Math.min(100, (paid / budget) * 100));
  const committedWidth = Math.max(0, Math.min(100 - paidWidth, (committed / budget) * 100));
  return (
    <div className="mt-auto flex items-center gap-3">
      <div aria-hidden="true" className="flex h-1 min-w-0 flex-1 bg-hairline">
        {over ? (
          <div className="h-full w-full bg-negative" />
        ) : (
          <>
            <div className="h-full bg-navy" style={{ width: `${paidWidth}%` }} />
            <div className="h-full bg-accent" style={{ width: `${committedWidth}%` }} />
          </>
        )}
      </div>
      <span className={cn("num shrink-0 text-small", over ? "text-negative" : "text-muted")}>
        {formatPercent(share, { digits: 0 })}
        <span className="sr-only"> {el.projectPage.list.ofBudget}</span>
      </span>
    </div>
  );
}
