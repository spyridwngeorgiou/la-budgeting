"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FilterChip, Input, Select, Toolbar, ViewSwitch, buttonClass } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { isIsoDate } from "@/lib/dates";
import { TX_BASE, activeFilterCount, hasAnyFilter, txFilterHref, type TxParams } from "./filterHref";

const t = el.transaction.filters;
const LABEL = "eyebrow text-muted";
// Selects and dates at the shared 40px, 44px on a touch screen.
const CONTROL = "pointer-coarse:min-h-11 max-md:w-full";

interface Option {
  id: string;
  label: string;
}

// The one filter row of /transactions: search, type, status, project,
// category, account, period and one «Καθαρισμός». Every control writes the
// URL (txFilterHref keeps the search and every other filter), so a view is
// a shareable link. A contact or scope set by a drill-down link shows as a
// chip that removes it. On a phone the row folds into «Φίλτρα (n) ▸»: a
// native <details> as the toggle (peer) with the controls after it, so
// nothing is rendered twice and no script decides what is open.
export function TransactionFilters({
  params,
  projects,
  categories,
  accounts,
  contactName,
}: {
  params: TxParams;
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  contactName: string | null;
}) {
  const router = useRouter();
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const go = (changes: Record<string, string | null>) => router.push(txFilterHref(params, changes), { scroll: false });
  const count = activeFilterCount(params);

  // The search box: what is being typed (null = follow the URL). It goes
  // to the URL after a short pause; once the URL carries it, the URL is the
  // truth again, so «Καθαρισμός» or the back button refill the box.
  const urlQuery = one("q");
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null && draft === urlQuery) setDraft(null);
  useEffect(() => {
    if (draft === null) return;
    const q = draft.trim();
    if (q === urlQuery) return;
    const timer = setTimeout(() => router.replace(txFilterHref(params, { q: q || null }), { scroll: false }), 400);
    return () => clearTimeout(timer);
  }, [draft, urlQuery, params, router]);

  const searchId = useId();
  const periodId = useId();

  // A date input reports every complete date while the year is still being
  // typed (0002, 0020 …): only a real date (or a cleared field) filters.
  const pickDate = (key: "from" | "to", value: string) => {
    if (value === "" || (isIsoDate(value) && value >= "1900-01-01")) go({ [key]: value || null });
  };

  const from = one("from");
  const to = one("to");
  const contactId = one("contact_id");
  const scope = one("scope");

  return (
    <Toolbar label={t.label} className="border-b border-hairline pb-4">
      <div className="flex w-full flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 md:w-72 md:flex-none">
          <label htmlFor={searchId} className={LABEL}>
            {t.search}
          </label>
          <Input
            id={searchId}
            type="search"
            placeholder={t.searchPlaceholder}
            value={draft ?? urlQuery}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full pointer-coarse:min-h-11"
          />
        </div>

        <details className="peer group md:hidden">
          <summary className={buttonClass("secondary", "md", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
            {t.toggle}
            {count > 0 && <span className="num">({count})</span>}
            <span aria-hidden="true" className="inline-block text-muted transition-transform group-open:rotate-90">
              ▸
            </span>
          </summary>
        </details>

        <div className="hidden w-full flex-wrap items-end gap-x-4 gap-y-3 peer-open:flex md:contents">
          <ViewSwitch
            label={el.transaction.type}
            active={one("direction")}
            className="[&_a]:min-h-10"
            options={[
              { key: "", label: t.all, href: txFilterHref(params, { direction: null }) },
              { key: "income", label: t.incomes, href: txFilterHref(params, { direction: "income" }) },
              { key: "expense", label: t.expenses, href: txFilterHref(params, { direction: "expense" }) },
            ]}
          />
          <ViewSwitch
            label={el.transaction.status}
            active={one("status")}
            className="[&_a]:min-h-10"
            options={(["", "paid", "pending", "scheduled"] as const).map((s) => ({
              key: s,
              label: s ? el.transaction[s] : t.all,
              href: txFilterHref(params, { status: s || null }),
            }))}
          />
          <EntitySelect label={el.transaction.project} value={one("project_id")} options={projects} onPick={(v) => go({ project_id: v || null })} />
          <EntitySelect label={el.transaction.category} value={one("category_id")} options={categories} onPick={(v) => go({ category_id: v || null })} />
          <EntitySelect label={el.transaction.accountColumn} value={one("account_id")} options={accounts} onPick={(v) => go({ account_id: v || null })} />

          <div role="group" aria-labelledby={periodId} className="flex min-w-0 flex-col gap-1.5 max-md:w-full">
            <span id={periodId} className={LABEL}>
              {t.period}
            </span>
            <div className="flex items-center gap-2">
              <Input
                key={`from-${from}`}
                type="date"
                aria-label={t.from}
                defaultValue={from}
                max={to || undefined}
                onChange={(e) => pickDate("from", e.target.value)}
                className="num min-w-0 flex-1 pointer-coarse:min-h-11 md:w-40 md:flex-none"
              />
              <span aria-hidden="true" className="text-muted">
                –
              </span>
              <Input
                key={`to-${to}`}
                type="date"
                aria-label={t.to}
                defaultValue={to}
                min={from || undefined}
                onChange={(e) => pickDate("to", e.target.value)}
                className="num min-w-0 flex-1 pointer-coarse:min-h-11 md:w-40 md:flex-none"
              />
            </div>
          </div>

          {contactId && (
            <FilterChip href={txFilterHref(params, { contact_id: null })} active className="min-h-10 pointer-coarse:min-h-11">
              {el.transaction.contact}: {contactName ?? "…"}
              <span aria-hidden="true">×</span>
              <span className="sr-only">{t.remove}</span>
            </FilterChip>
          )}
          {(scope === "business" || scope === "personal") && (
            <FilterChip href={txFilterHref(params, { scope: null })} active className="min-h-10 pointer-coarse:min-h-11">
              {el.transaction.scope}: {el.transaction.scopeValues[scope]}
              <span aria-hidden="true">×</span>
              <span className="sr-only">{t.remove}</span>
            </FilterChip>
          )}

          {hasAnyFilter(params) && (
            <Link href={TX_BASE} onClick={() => setDraft(null)} className={buttonClass("ghost", "md", "underline underline-offset-4")}>
              {t.clear}
            </Link>
          )}
        </div>
      </div>
    </Toolbar>
  );
}

// A select that is its URL value: uncontrolled, remounted (key) when the
// URL changes it, so a pick shows at once and «Καθαρισμός» resets it.
function EntitySelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: Option[];
  onPick: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 max-md:w-full">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <Select key={value} id={id} defaultValue={value} onChange={(e) => onPick(e.target.value)} className={`${CONTROL} md:max-w-52`}>
        <option value="">{t.all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
