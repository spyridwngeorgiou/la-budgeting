"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { SubNavKeepingParams } from "@/components/SubNav";
import { SECTION_TABS } from "@/lib/navigation";

// The planner's tabs and filter bar. Filters live in the URL (shareable,
// back-button friendly, read by the server pages); switching tab keeps the
// project and assignee so "this project's board" becomes "this project's
// timeline" in one click.

const SHARED_PARAMS = ["project", "assignee"];

export function PlannerTabs({ base }: { base: string }) {
  const tabs = SECTION_TABS.planner.map((t) => ({ ...t, href: base + t.href.slice("/planner".length) }));
  return <SubNavKeepingParams tabs={tabs} label={el.planner.title} keep={SHARED_PARAMS} />;
}

export interface FilterOption {
  id: string;
  label: string;
}

export function PlannerFilters({
  projects,
  people,
  showSearch = true,
  showArchived = false,
  meId,
}: {
  projects: FilterOption[];
  people?: FilterOption[];
  showSearch?: boolean;
  showArchived?: boolean;
  meId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`));
  }

  return (
    <div
      className={`flex flex-wrap items-end gap-2 transition-opacity ${isPending ? "opacity-60" : ""}`}
      data-pending={isPending ? "" : undefined}
    >
      {projects.length > 1 && (
        <Select
          aria-label={el.planner.project}
          value={params.get("project") ?? ""}
          onChange={(e) => setParam("project", e.target.value || null)}
          className="max-w-full sm:max-w-64"
        >
          <option value="">{el.planner.allProjects}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      )}
      {people && (
        <Select
          aria-label={el.planner.assignee}
          value={params.get("assignee") ?? ""}
          onChange={(e) => setParam("assignee", e.target.value || null)}
        >
          <option value="">{el.planner.anyone}</option>
          {meId && <option value={meId}>{el.planner.mine}</option>}
          <option value="none">{el.planner.unassigned}</option>
          {people
            .filter((p) => p.id !== meId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </Select>
      )}
      {showSearch && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
            setParam("q", q || null);
          }}
        >
          <input
            type="search"
            name="q"
            defaultValue={params.get("q") ?? ""}
            placeholder={el.planner.search}
            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
          />
        </form>
      )}
      {showArchived && (
        <label className="flex items-center gap-1.5 px-1 py-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={params.get("archived") === "1"}
            onChange={(e) => setParam("archived", e.target.checked ? "1" : null)}
            className="accent-sage-ink"
          />
          {el.planner.showArchived}
        </label>
      )}
    </div>
  );
}
