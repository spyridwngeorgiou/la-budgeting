import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Button,
  Field,
  Input,
  KpiBand,
  LINK_CLASS,
  MoneyInput,
  Notice,
  PageHeader,
  ReportChart,
  ReportHistory,
  ReportSection,
  SectionHeader,
  Select,
  SpecTable,
  Td,
  Th,
  Tr,
  ViewSwitch,
  cn,
} from "@/components/ui";
import { BandChart } from "@/components/ui/BandChart";
import { addMonths, currentMonthKey, firstOfMonth, monthLabel, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { FORECAST_HORIZONS, parseHorizon } from "@/lib/finance/forecastParams";
import { parseAmountInput } from "@/lib/amountInput";
import {
  decodeChanges,
  encodeChange,
  runWhatIf,
  whatIfGroups,
  whatIfSummary,
  type Change,
  type WhatIfGroup,
  type WhatIfItem,
} from "@/lib/finance/whatIf";

// Σενάρια -- «τι θα γινόταν αν». The forecast of Ταμείο & Πρόβλεψη (base
// scenario, all accounts) re-run with the owner's changes on top: move a
// group of rows in time, drop one, add a new amount, draw cash from a bank.
// Nothing is stored: the changes live in the URL (?c=…, lib/finance/whatIf),
// so a scenario is kept as a bookmark or sent as a link. The forms are plain
// GET forms; the page turns ?op=… into one more ?c= and redirects.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const T = {
  title: "Σενάρια",
  meta: "Τι θα γινόταν αν; Δοκιμάστε αλλαγές πάνω στην πρόβλεψη του ταμείου. Δεν αποθηκεύεται τίποτα: οι αλλαγές μένουν στον σύνδεσμο της σελίδας.",
  lowest: "Χαμηλότερο σημείο",
  end: "Στο τέλος του ορίζοντα",
  cash: "Μετρητά",
  cashOk: "επαρκούν",
  cashOut: (m: string) => `τελειώνουν ${m}`,
  today: "Σήμερα",
  withChanges: "Με τις αλλαγές",
  diff: "Διαφορά",
  banks: "Τράπεζες",
  changes: "Αλλαγές",
  noChanges: "Καμία αλλαγή ακόμα — η πρόβλεψη είναι όπως στο Ταμείο. Προσθέστε μία από κάτω.",
  clear: "Καθαρισμός όλων",
  add: "Προσθήκη",
  remove: "Αφαίρεση",
  invalid: "Η αλλαγή δεν προστέθηκε: ελέγξτε το ποσό και τον μήνα.",
  shiftTitle: "Μετάθεση στον χρόνο",
  dropTitle: "Δεν γίνεται",
  addTitle: "Νέο ποσό",
  moveTitle: "Ανάληψη τράπεζα → μετρητά",
  what: "Κίνηση",
  months: "Μήνες",
  month: "Μήνας",
  amount: "Ποσό",
  kind: "Είδος",
  income: "Έσοδο",
  expense: "Έξοδο",
  account: "Από/σε",
  bank: "Τράπεζα",
  label: "Περιγραφή",
  balanceTitle: "Υπόλοιπο ταμείου στο τέλος κάθε μήνα",
  gone: "κίνηση που δεν υπάρχει πια",
  newAmount: "Νέο ποσό",
  shiftText: (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)} ${Math.abs(n) === 1 ? "μήνας" : "μήνες"}`,
  dropText: "δεν γίνεται",
  moveText: (amount: string, month: string) => `Ανάληψη ${amount} από τράπεζα σε μετρητά · ${month}`,
};

const SHIFTS = [-6, -3, -2, -1, 1, 2, 3, 4, 6, 9, 12];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ScenariosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const months = parseHorizon(sp.months, 12);
  const changes = decodeChanges(sp.c);
  const firstMonth = currentMonthKey();
  const horizonEnd = addMonths(firstMonth, months);
  const monthKeys = Array.from({ length: months }, (_, i) => addMonths(firstMonth, i));

  const href = (list: Change[], extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (months !== 12) p.set("months", String(months));
    for (const c of list) p.append("c", encodeChange(c));
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/scenarios?${s}` : "/reports/scenarios";
  };

  // A submitted form: one more change, then the clean URL.
  const op = first(sp.op);
  if (op) {
    const added = changeFromForm(op, sp, monthKeys);
    redirect(added ? href([...changes, added]) : href(changes, { err: "1" }));
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const today = todayAthens();

  const [{ data: items, error }, { data: kinds }, { data: buffer }, { data: cashAccounts }] = await Promise.all([
    supabase
      .rpc("cash_forecast_items", { p_org: orgId, p_scenario: "base" })
      .lt("month", firstOfMonth(horizonEnd)),
    supabase.rpc("cash_forecast_by_kind", { p_org: orgId, p_months: 1 }),
    supabase.rpc("org_cash_buffer", { p_org: orgId }),
    supabase.from("accounts").select("id").eq("org_id", orgId).eq("kind", "cash").eq("is_liquid", true),
  ]);
  if (error) throw error;

  // Which forecast rows sit on a «Μετρητά» account (same rule as 0097).
  const cashIds = (cashAccounts ?? []).map((a) => a.id);
  const { data: cashTx } = cashIds.length
    ? await supabase
        .from("transactions")
        .select("id")
        .eq("org_id", orgId)
        .in("account_id", cashIds)
        .or(`status.in.(pending,scheduled),paid_on.gt.${today},tx_date.gt.${today}`)
    : { data: [] as { id: string }[] };
  const onCash = new Set((cashTx ?? []).map((t) => t.id));

  const whatIfItems: WhatIfItem[] = (items ?? []).map((i) => ({
    item_key: i.item_key,
    source: i.source,
    ref_id: i.ref_id,
    label: i.label,
    month: i.month,
    direction: i.direction,
    weighted_amount: i.weighted_amount,
    cash: i.item_key.startsWith("tx:") && onCash.has(i.ref_id),
  }));
  const opening = kinds?.[0];
  const base = {
    firstMonth,
    months,
    openingBank: Number(opening?.bank_opening ?? 0),
    openingCash: Number(opening?.cash_opening ?? 0),
    items: whatIfItems,
  };
  const now = runWhatIf({ ...base, changes: [] });
  const after = runWhatIf({ ...base, changes });
  const sNow = whatIfSummary(now);
  const sAfter = whatIfSummary(after);
  const hasCash = now.some((r) => r.cash !== 0) || after.some((r) => r.cash !== 0);

  const groups = whatIfGroups(whatIfItems);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const sources = el.reports.sources as Record<string, string>;
  const t = el.reports;

  const chartData = monthKeys.map((m, i) => ({ label: shortMonthYearLabel(m), after: after[i].total, now: now[i].total }));
  const buf = Number(buffer ?? 0);
  const changed = changes.length > 0;
  const arrow = (a: string, b: string) => (changed && a !== b ? `${a} → ${b}` : b);
  const hidden = (
    <>
      {months !== 12 && <input type="hidden" name="months" value={months} />}
      {changes.map((c, i) => (
        <input key={i} type="hidden" name="c" value={encodeChange(c)} />
      ))}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={T.title} meta={T.meta} />

      <ViewSwitch
        label={t.horizon}
        options={FORECAST_HORIZONS.map((h) => {
          const p = new URLSearchParams();
          if (h !== 12) p.set("months", String(h));
          for (const c of changes) p.append("c", encodeChange(c));
          const s = p.toString();
          return { key: String(h), label: `${h} ${t.months}`, href: s ? `/reports/scenarios?${s}` : "/reports/scenarios" };
        })}
        active={String(months)}
      />

      <ReportSection label={T.title}>
        <KpiBand
          items={[
            {
              label: T.lowest,
              value: (
                <span className={cn((sAfter.lowest?.total ?? 0) < buf && "text-negative")}>
                  {formatMoney(sAfter.lowest?.total ?? 0)}
                </span>
              ),
              sub: sAfter.lowest
                ? arrow(
                    `${T.today.toLowerCase()} ${formatMoney(sNow.lowest?.total ?? 0)}`,
                    monthLabel(sAfter.lowest.month),
                  )
                : undefined,
            },
            {
              label: T.end,
              value: formatMoney(sAfter.end?.total ?? 0),
              sub: changed ? `${T.diff.toLowerCase()} ${formatSignedMoney((sAfter.end?.total ?? 0) - (sNow.end?.total ?? 0))}` : undefined,
            },
            ...(hasCash
              ? [
                  {
                    label: T.cash,
                    value: (
                      <span className={cn(sAfter.cashOut && "text-negative")}>
                        {sAfter.cashOut ? T.cashOut(monthLabel(sAfter.cashOut.month)) : T.cashOk}
                      </span>
                    ),
                    sub: changed
                      ? `${T.today.toLowerCase()}: ${sNow.cashOut ? T.cashOut(monthLabel(sNow.cashOut.month)) : T.cashOk}`
                      : undefined,
                  },
                ]
              : []),
          ]}
        />

        {/* Αλλαγές: the list, each removable, then the four ways to add one. */}
        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader
            as="h3"
            title={T.changes}
            actions={
              changed ? (
                <Link href={href([])} className={cn(LINK_CLASS, "inline-flex min-h-11 items-center text-body")}>
                  {T.clear}
                </Link>
              ) : undefined
            }
          />
          {first(sp.err) && <Notice tone="negative">{T.invalid}</Notice>}
          {changed ? (
            <ul className="flex flex-col">
              {changes.map((c, i) => (
                <li key={i} className="flex min-h-11 items-center justify-between gap-3 border-b border-hairline py-2 text-body text-ink">
                  <span>{changeText(c, groupById)}</span>
                  <Link
                    href={href(changes.filter((_, j) => j !== i))}
                    aria-label={T.remove}
                    title={T.remove}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-ink"
                  >
                    ✕
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted">{T.noChanges}</p>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
            <AddForm title={T.shiftTitle} op="s" hidden={hidden}>
              <GroupSelect id="s-g" groups={groups} sources={sources} />
              <Field label={T.months} htmlFor="s-n">
                <Select id="s-n" name="n" defaultValue="3">
                  {SHIFTS.map((n) => (
                    <option key={n} value={n}>
                      {T.shiftText(n)}
                    </option>
                  ))}
                </Select>
              </Field>
            </AddForm>

            <AddForm title={T.dropTitle} op="d" hidden={hidden}>
              <GroupSelect id="d-g" groups={groups} sources={sources} />
            </AddForm>

            <AddForm title={T.addTitle} op="a" hidden={hidden}>
              <Field label={T.kind} htmlFor="a-dir">
                <Select id="a-dir" name="dir" defaultValue="expense">
                  <option value="expense">{T.expense}</option>
                  <option value="income">{T.income}</option>
                </Select>
              </Field>
              <Field label={T.amount} htmlFor="a-amt">
                <MoneyInput id="a-amt" name="amt" required className="w-36" />
              </Field>
              <MonthSelect id="a-m" keys={monthKeys} />
              {hasCash && (
                <Field label={T.account} htmlFor="a-acc">
                  <Select id="a-acc" name="acc" defaultValue="b">
                    <option value="b">{T.bank}</option>
                    <option value="c">{T.cash}</option>
                  </Select>
                </Field>
              )}
              <Field label={T.label} htmlFor="a-label">
                <Input id="a-label" name="label" maxLength={60} className="w-48" />
              </Field>
            </AddForm>

            {hasCash && (
              <AddForm title={T.moveTitle} op="w" hidden={hidden}>
                <Field label={T.amount} htmlFor="w-amt">
                  <MoneyInput id="w-amt" name="amt" required className="w-36" />
                </Field>
                <MonthSelect id="w-m" keys={monthKeys} />
              </AddForm>
            )}
          </div>
        </section>

        <ReportChart
          title={T.balanceTitle}
          caption={`${months} ${t.months} · ${t.scenarios.base}${changed ? ` · ${T.withChanges.toLowerCase()} και ${T.today.toLowerCase()}` : ""}`}
        >
          <BandChart
            data={chartData}
            xKey="label"
            series={changed ? [{ key: "after", name: T.withChanges }, { key: "now", name: T.today }] : [{ key: "now", name: T.today }]}
            label={T.balanceTitle}
            threshold={{ value: buf, label: t.buffer }}
          />
        </ReportChart>

        <ReportHistory count={months} open>
          <SpecTable label={T.title} stickyFirst>
            <thead>
              <tr>
                <Th>{t.month}</Th>
                {changed && <Th numeric>{T.today}</Th>}
                <Th numeric>{changed ? T.withChanges : t.closing}</Th>
                {changed && (
                  <Th numeric className="hidden sm:table-cell">
                    {T.diff}
                  </Th>
                )}
                {hasCash && (
                  <>
                    <Th numeric className="hidden md:table-cell">
                      {T.banks}
                    </Th>
                    <Th numeric className="hidden md:table-cell">
                      {T.cash}
                    </Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {after.map((r, i) => {
                const d = r.total - now[i].total;
                return (
                  <Tr key={r.month}>
                    <Td strong>{shortMonthYearLabel(r.month)}</Td>
                    {changed && <Td numeric>{formatMoney(now[i].total)}</Td>}
                    <Td numeric strong className={cn("font-medium", r.total < buf && "text-negative")}>
                      {formatMoney(r.total)}
                    </Td>
                    {changed && (
                      <Td numeric className={cn("hidden sm:table-cell", d < 0 && "text-negative")}>
                        {Math.abs(d) < 0.005 ? "—" : formatSignedMoney(d)}
                      </Td>
                    )}
                    {hasCash && (
                      <>
                        <Td numeric className={cn("hidden md:table-cell", r.bank < 0 && "text-negative")}>
                          {formatMoney(r.bank)}
                        </Td>
                        <Td numeric className={cn("hidden md:table-cell", r.cash < 0 && "text-negative")}>
                          {formatMoney(r.cash)}
                        </Td>
                      </>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>
        </ReportHistory>
      </ReportSection>
    </div>
  );
}

// ?op=… from one of the four forms → the change, or null when a field is wrong.
function changeFromForm(
  op: string,
  sp: Record<string, string | string[] | undefined>,
  monthKeys: string[],
): Change | null {
  const g = first(sp.g);
  const m = first(sp.m);
  const okMonth = !!m && monthKeys.includes(m);
  const amt = parseAmountInput(first(sp.amt) ?? null);
  if (op === "s") {
    const n = Number(first(sp.n));
    return g && SHIFTS.includes(n) ? { t: "shift", g, n } : null;
  }
  if (op === "d") return g ? { t: "drop", g } : null;
  if (op === "a" && okMonth && amt !== null && amt > 0) {
    return {
      t: "add",
      m: m!,
      amount: first(sp.dir) === "income" ? amt : -amt,
      cash: first(sp.acc) === "c",
      label: (first(sp.label) ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    };
  }
  if (op === "w" && okMonth && amt !== null && amt > 0) return { t: "move", m: m!, amount: amt };
  return null;
}

function changeText(c: Change, groups: Map<string, WhatIfGroup>): string {
  if (c.t === "shift" || c.t === "drop") {
    const g = groups.get(c.g);
    const name = g ? g.label || el.reports.sources[g.source as keyof typeof el.reports.sources] || g.source : T.gone;
    return `${name}: ${c.t === "shift" ? T.shiftText(c.n) : T.dropText}`;
  }
  if (c.t === "add") {
    return `${c.label || T.newAmount}: ${formatSignedMoney(c.amount)} · ${monthLabel(c.m)} · ${c.cash ? T.cash.toLowerCase() : T.bank.toLowerCase()}`;
  }
  return T.moveText(formatMoney(c.amount), monthLabel(c.m));
}

function AddForm({ title, op, hidden, children }: { title: string; op: string; hidden: React.ReactNode; children: React.ReactNode }) {
  return (
    <form method="get" action="/reports/scenarios" className="flex min-w-0 flex-col gap-2 border-t border-hairline pt-3">
      <span className="heading text-body text-ink">{title}</span>
      {hidden}
      <input type="hidden" name="op" value={op} />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        {children}
        <Button type="submit" variant="secondary">
          {T.add}
        </Button>
      </div>
    </form>
  );
}

// The groups by source, each with its first month and amount in the horizon.
function GroupSelect({ id, groups, sources }: { id: string; groups: WhatIfGroup[]; sources: Record<string, string> }) {
  const bySource = new Map<string, WhatIfGroup[]>();
  for (const g of groups) bySource.set(g.source, [...(bySource.get(g.source) ?? []), g]);
  return (
    <Field label={T.what} htmlFor={id} className="min-w-0 flex-1 basis-64">
      <Select id={id} name="g" required className="w-full">
        {[...bySource.entries()].map(([source, list]) => (
          <optgroup key={source} label={sources[source] ?? source}>
            {list.map((g) => (
              <option key={g.id} value={g.id}>
                {`${g.label || sources[g.source] || g.source} · ${g.count > 1 ? `${g.count} κινήσεις από ` : ""}${shortMonthYearLabel(g.firstMonth)} · ${formatSignedMoney(g.income - g.expense)}`}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

function MonthSelect({ id, keys }: { id: string; keys: string[] }) {
  return (
    <Field label={T.month} htmlFor={id}>
      <Select id={id} name="m" defaultValue={keys[0]}>
        {keys.map((k) => (
          <option key={k} value={k}>
            {shortMonthYearLabel(k)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
