"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Checkbox, Input, Select, cn } from "@/components/ui";
import { el } from "@/lib/i18n/el";

// The planner's filter bar. Filters live in the URL (shareable, back-button
// friendly, read by the server page); changing one keeps every other param,
// the ?view= of PlannerViews included.

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
      className={cn("flex flex-wrap items-center gap-2 transition-opacity max-sm:w-full", isPending && "opacity-60")}
      data-pending={isPending ? "" : undefined}
    >
      {projects.length > 1 && (
        <Select
          aria-label={el.planner.project}
          value={params.get("project") ?? ""}
          onChange={(e) => setParam("project", e.target.value || null)}
          className="max-w-full max-sm:w-full sm:max-w-64"
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
          className="max-sm:w-full"
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
          className="max-sm:w-full"
        >
          <Input
            type="search"
            name="q"
            aria-label={el.planner.search}
            defaultValue={params.get("q") ?? ""}
            placeholder={el.planner.search}
            className="w-full sm:w-64"
          />
        </form>
      )}
      {showArchived && (
        <Checkbox
          label={el.planner.showArchived}
          checked={params.get("archived") === "1"}
          onChange={(e) => setParam("archived", e.target.checked ? "1" : null)}
          className="px-1 text-text max-md:min-h-11"
        />
      )}
    </div>
  );
}
