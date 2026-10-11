"use client";

import { useRouter, usePathname } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";

// P15 filter row: eyebrow labels, square chips (navy only when active),
// controls at the shared 40px height -- 44px on a phone.
const LABEL = "eyebrow text-muted";
const CHIP = "inline-flex min-h-11 items-center border px-3 py-1 text-small whitespace-nowrap transition-colors md:min-h-9";
const CHIP_ON = "border-navy bg-navy text-panel-ink";
const CHIP_OFF = "border-chip-border text-text hover:border-navy hover:text-ink";
const CONTROL = "max-md:min-h-11 max-md:w-full";

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
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-hairline pb-4 sm:grid-cols-2 md:flex md:flex-wrap md:items-end">
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

      <div className="flex min-w-0 flex-none flex-col gap-1.5">
        <span className={LABEL}>Περίοδος</span>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={current.from ?? ""}
            onChange={(e) => setParam("from", e.target.value)}
            className="num min-w-0 flex-1 max-md:min-h-11 md:flex-none"
          />
          <span aria-hidden="true" className="text-muted">
            –
          </span>
          <Input
            type="date"
            value={current.to ?? ""}
            onChange={(e) => setParam("to", e.target.value)}
            className="num min-w-0 flex-1 max-md:min-h-11 md:flex-none"
          />
        </div>
      </div>

      <EntitySelect label="Έργο" value={current.project_id ?? ""} onChange={(v) => setParam("project_id", v)} options={projects} />
      <EntitySelect label="Επαφή" value={current.contact_id ?? ""} onChange={(v) => setParam("contact_id", v)} options={contacts} />
      <EntitySelect label="Κατηγορία" value={current.category_id ?? ""} onChange={(v) => setParam("category_id", v)} options={categories} />
      <EntitySelect label="Λογαριασμός" value={current.account_id ?? ""} onChange={(v) => setParam("account_id", v)} options={accounts} />

      {hasAnyFilter && (
        <Button
          variant="ghost"
          onClick={() => router.push(pathname)}
          className="self-end underline underline-offset-4 max-md:min-h-11 md:ml-auto"
        >
          Καθαρισμός φίλτρων
        </Button>
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
    <div role="group" aria-label={label} className="flex min-w-0 flex-none flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
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
    <label className="flex min-w-0 flex-none flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} md:max-w-56`}>
        <option value="">Όλα</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
