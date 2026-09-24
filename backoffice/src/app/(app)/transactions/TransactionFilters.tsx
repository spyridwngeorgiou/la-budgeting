"use client";

import { useRouter, usePathname } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

interface Props {
  current: {
    status?: string;
    direction?: string;
    scope?: string;
    from?: string;
    to?: string;
    project_id?: string;
    contact_id?: string;
    category_id?: string;
    account_id?: string;
  };
  projects: Option[];
  contacts: Option[];
  categories: Option[];
  accounts: Option[];
}

// A real filter panel for the ledger -- before this, the only way to filter
// by direction, date range, or entity was to arrive here via a drill-down
// link built elsewhere (dashboard/analysis/project pages); there was no way
// to set these from the page itself. Every control writes straight to the
// URL (no local state, no submit button) so the result is always a
// shareable/bookmarkable link, same as every other filtered view in the app.
export function TransactionFilters({ current, projects, contacts, categories, accounts }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function setParam(key: string, value: string) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(current)) {
      if (v) p.set(k, v);
    }
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }

  const hasAnyFilter = Object.values(current).some(Boolean);

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-md border border-line bg-surface p-3">
      <ChipGroup
        label="Κατεύθυνση"
        value={current.direction ?? ""}
        onChange={(v) => setParam("direction", v)}
        options={[
          { value: "", label: "Όλα" },
          { value: "income", label: "Έσοδα" },
          { value: "expense", label: "Έξοδα" },
        ]}
      />
      <ChipGroup
        label="Πεδίο"
        value={current.scope ?? ""}
        onChange={(v) => setParam("scope", v)}
        options={[
          { value: "", label: "Όλα" },
          { value: "business", label: "Επιχειρηματικό" },
          { value: "personal", label: "Προσωπικό" },
        ]}
      />

      <div className="flex flex-none flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">Περίοδος</span>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={current.from ?? ""}
            onChange={(e) => setParam("from", e.target.value)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink focus:border-sage-strong focus:outline-none"
          />
          <span className="text-ink-faint">–</span>
          <input
            type="date"
            value={current.to ?? ""}
            onChange={(e) => setParam("to", e.target.value)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink focus:border-sage-strong focus:outline-none"
          />
        </div>
      </div>

      <EntitySelect label="Έργο" value={current.project_id ?? ""} onChange={(v) => setParam("project_id", v)} options={projects} />
      <EntitySelect label="Επαφή" value={current.contact_id ?? ""} onChange={(v) => setParam("contact_id", v)} options={contacts} />
      <EntitySelect label="Κατηγορία" value={current.category_id ?? ""} onChange={(v) => setParam("category_id", v)} options={categories} />
      <EntitySelect label="Λογαριασμός" value={current.account_id ?? ""} onChange={(v) => setParam("account_id", v)} options={accounts} />

      {hasAnyFilter && (
        <button
          onClick={() => router.push(pathname)}
          className="ml-auto self-end rounded-full border border-line-strong px-3 py-1 text-xs text-ink-muted hover:bg-bg"
        >
          Καθαρισμός φίλτρων
        </button>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-none flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-ink bg-ink text-white"
                  : "border-line-strong bg-surface text-ink-muted hover:border-ink-faint hover:bg-bg"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EntitySelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <div className="flex flex-none flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink focus:border-sage-strong focus:outline-none"
      >
        <option value="">Όλα</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
