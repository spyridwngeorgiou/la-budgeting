import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
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
  checkGoals,
  decodeChanges,
  encodeChange,
  isGoal,
  ruleCount,
  runWhatIf,
  whatIfGroups,
  whatIfSummary,
  type Change,
  type GoalResult,
  type RuleChange,
  type RuleDir,
  type WhatIfGroup,
  type WhatIfItem,
  type WhatIfRow,
} from "@/lib/finance/whatIf";
import { deleteScenario, saveScenario } from "./actions";

// Σενάρια -- «τι θα γινόταν αν». The forecast of Ταμείο & Πρόβλεψη (base
// scenario, all accounts) re-run with the owner's changes on top
// (lib/finance/whatIf): move or drop a group of rows, rules over many rows
// at once, new one-off or monthly amounts, money moved between bank and
// cash, and goals (a cash floor, a bank balance by a month) checked with a
// suggested fix. The changes live in the URL (?c=…); a scenario can be
// saved under a name (forecast_scenarios, 0098, ?s=) and is re-run on the
// day's forecast whenever it is opened. The forms are plain GET forms; the
// page turns ?op=… into one more ?c= and redirects.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const T = {
  title: "Σενάρια",
  meta: "Τι θα γινόταν αν; Δοκιμάστε αλλαγές πάνω στην πρόβλεψη του ταμείου — η πραγματική πρόβλεψη δεν αλλάζει. Ένα σενάριο μπορεί να αποθηκευτεί με όνομα.",
  saved: "Αποθηκευμένα σενάρια",
  noneSaved: "Κανένα ακόμα.",
  todayRow: "Σήμερα, χωρίς αλλαγές",
  name: "Σενάριο",
  lowest: "Χαμηλότερο σημείο",
  end: "Στο τέλος του ορίζοντα",
  cash: "Μετρητά",
  cashOk: "επαρκούν",
  cashOut: (m: string) => `τελειώνουν ${m}`,
  today: "Σήμερα",
  withChanges: "Με τις αλλαγές",
  diff: "Διαφορά",
  banks: "Τράπεζες",
  goals: "Στόχοι",
  tryIt: "Δοκίμασέ το →",
  changes: "Αλλαγές",
  noChanges: "Καμία αλλαγή ακόμα — η πρόβλεψη είναι όπως στο Ταμείο.",
  clear: "Καθαρισμός όλων",
  addChange: "Προσθήκη αλλαγής",
  add: "Προσθήκη",
  remove: "Αφαίρεση",
  save: "Αποθήκευση",
  update: "Ενημέρωση",
  saveNew: "Ως νέο",
  del: "Διαγραφή",
  saveName: "Όνομα σεναρίου",
  modified: "με αλλαγές που δεν έχουν αποθηκευτεί",
  errors: {
    "1": "Η αλλαγή δεν προστέθηκε: ελέγξτε το ποσό και τον μήνα.",
    name: "Δώστε όνομα στο σενάριο (και τουλάχιστον μία αλλαγή).",
    save: "Δεν αποθηκεύτηκε — χρειάζεται δικαίωμα επεξεργασίας.",
  } as Record<string, string>,
  shiftTitle: "Μετάθεση στον χρόνο",
  dropTitle: "Δεν γίνεται",
  ruleTitle: "Κανόνας για πολλές κινήσεις",
  addTitle: "Νέο ποσό",
  moveTitle: "Μεταφορά τράπεζα ⇄ μετρητά",
  goalTitle: "Στόχος",
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
  repeat: "Επανάληψη",
  once: "Μία φορά",
  monthlyTo: (m: string) => `κάθε μήνα έως ${m}`,
  monthlyEnd: "κάθε μήνα, έως το τέλος",
  which: "Ποιες",
  project: "Έργο",
  allProjects: "Όλα τα έργα",
  only: "Μόνο",
  all: "Όλες",
  uncertainOnly: "Μόνο αβέβαιες",
  action: "Τι γίνεται",
  direction: "Κατεύθυνση",
  toCash: "Τράπεζα → μετρητά",
  toBank: "Μετρητά → τράπεζα",
  goalKind: "Στόχος",
  cashFloorOpt: "Μετρητά πάντα πάνω από",
  bankGoalOpt: "Τράπεζες τουλάχιστον, στο τέλος του μήνα",
  balanceTitle: "Υπόλοιπο ταμείου στο τέλος κάθε μήνα",
  gone: "κίνηση που δεν υπάρχει πια",
  newAmount: "Νέο ποσό",
  shiftText: (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)} ${Math.abs(n) === 1 ? "μήνας" : "μήνες"}`,
  dropText: "δεν γίνεται",
};

const SHIFTS = [-6, -3, -2, -1, 1, 2, 3, 4, 6, 9, 12];
const PERCENTS = [-50, -25, -10, 10, 25, 50];
const RULE_DIRS = { e: "Όλα τα έξοδα", i: "Όλα τα έσοδα", a: "Όλες οι κινήσεις" } as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ScenariosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const months = parseHorizon(sp.months, 12);
  const changes = decodeChanges(sp.c);
  const savedId = first(sp.s) ?? null;
  const firstMonth = currentMonthKey();
  const horizonEnd = addMonths(firstMonth, months);
  const monthKeys = Array.from({ length: months }, (_, i) => addMonths(firstMonth, i));

  const href = (list: Change[], opts: { s?: string | null; m?: number } = {}) => {
    const p = new URLSearchParams();
    const m = opts.m ?? months;
    if (m !== 12) p.set("months", String(m));
    const s = opts.s === undefined ? savedId : opts.s;
    if (s) p.set("s", s);
    for (const c of list) p.append("c", encodeChange(c));
    const q = p.toString();
    return q ? `/reports/scenarios?${q}` : "/reports/scenarios";
  };

  // A submitted form: one more change, then the clean URL.
  const op = first(sp.op);
  if (op) {
    const added = changeFromForm(op, sp, monthKeys);
    redirect(added ? href([...changes, added]) : `${href(changes)}${href(changes).includes("?") ? "&" : "?"}err=1`);
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const today = todayAthens();

  const [{ data: items, error }, { data: kinds }, { data: buffer }, { data: cashAccounts }, { data: saved }, { data: projects }] =
    await Promise.all([
      supabase
        .rpc("cash_forecast_items", { p_org: orgId, p_scenario: "base" })
        .lt("month", firstOfMonth(horizonEnd)),
      supabase.rpc("cash_forecast_by_kind", { p_org: orgId, p_months: 1 }),
      supabase.rpc("org_cash_buffer", { p_org: orgId }),
      supabase.from("accounts").select("id").eq("org_id", orgId).eq("kind", "cash").eq("is_liquid", true),
      supabase.from("forecast_scenarios").select("id, name, changes").eq("org_id", orgId).order("name"),
      supabase.from("projects").select("id, display_name").eq("org_id", orgId).order("display_name"),
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
    project_id: i.project_id,
    probability: i.probability,
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
  const goals = checkGoals(after, changes);
  const hasCash = now.some((r) => r.cash !== 0) || after.some((r) => r.cash !== 0);
  const moneyChanges = changes.filter((c) => !isGoal(c));
  const changed = moneyChanges.length > 0;

  // Saved scenarios, each re-run on today's forecast.
  const savedRows = (saved ?? []).map((s) => {
    const list = decodeChanges(s.changes);
    return { id: s.id, name: s.name, changes: list, summary: whatIfSummary(runWhatIf({ ...base, changes: list })) };
  });
  const current = savedRows.find((s) => s.id === savedId) ?? null;
  const dirty = current ? current.changes.map(encodeChange).join("|") !== changes.map(encodeChange).join("|") : false;

  const groups = whatIfGroups(whatIfItems);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.display_name]));
  const forecastProjects = (projects ?? []).filter((p) => whatIfItems.some((i) => i.project_id === p.id));
  const sources = el.reports.sources as Record<string, string>;
  const t = el.reports;

  const chartData = monthKeys.map((m, i) => ({ label: shortMonthYearLabel(m), after: after[i].total, now: now[i].total }));
  const buf = Number(buffer ?? 0);
  const err = first(sp.err);
  const describe = (c: Change) => changeText(c, { groups: groupById, projects: projectNames, items: whatIfItems });

  const hidden = (
    <>
      {months !== 12 && <input type="hidden" name="months" value={months} />}
      {savedId && <input type="hidden" name="s" value={savedId} />}
      {changes.map((c, i) => (
        <input key={i} type="hidden" name="c" value={encodeChange(c)} />
      ))}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={current ? `${T.title}: ${current.name}` : T.title} meta={current && dirty ? T.modified : T.meta} />

      <ViewSwitch
        label={t.horizon}
        options={FORECAST_HORIZONS.map((h) => ({ key: String(h), label: `${h} ${t.months}`, href: href(changes, { m: h }) }))}
        active={String(months)}
      />

      {err && T.errors[err] && <Notice tone="negative">{T.errors[err]}</Notice>}

      {/* Αποθηκευμένα: each one re-run today, side by side with the forecast as is. */}
      {savedRows.length > 0 && (
        <section className="flex min-w-0 flex-col gap-2">
          <SectionHeader as="h3" title={T.saved} />
          <SpecTable label={T.saved}>
            <thead>
              <tr>
                <Th>{T.name}</Th>
                <Th numeric>{T.lowest}</Th>
                <Th numeric className="hidden sm:table-cell">
                  {T.end}
                </Th>
                {hasCash && <Th className="hidden md:table-cell">{T.cash}</Th>}
              </tr>
            </thead>
            <tbody>
              <SavedRow name={T.todayRow} href={href([], { s: null })} summary={sNow} hasCash={hasCash} muted />
              {savedRows.map((s) => (
                <SavedRow
                  key={s.id}
                  name={s.name}
                  href={href(s.changes, { s: s.id })}
                  summary={s.summary}
                  hasCash={hasCash}
                  active={s.id === savedId}
                />
              ))}
            </tbody>
          </SpecTable>
        </section>
      )}

      <ReportSection label={T.title}>
        <KpiBand
          items={[
            {
              label: T.lowest,
              value: (
                <span className={cn((sAfter.lowest?.total ?? 0) < buf && "text-negative")}>{formatMoney(sAfter.lowest?.total ?? 0)}</span>
              ),
              sub: sAfter.lowest
                ? changed
                  ? `${monthLabel(sAfter.lowest.month)} · σήμερα ${formatMoney(sNow.lowest?.total ?? 0)}`
                  : monthLabel(sAfter.lowest.month)
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
                    sub: changed ? `σήμερα: ${sNow.cashOut ? T.cashOut(monthLabel(sNow.cashOut.month)) : T.cashOk}` : undefined,
                  },
                ]
              : []),
          ]}
        />

        {/* Στόχοι: each checked against the run, with one move of money that meets it. */}
        {goals.length > 0 && (
          <section className="flex min-w-0 flex-col gap-2">
            <SectionHeader as="h3" title={T.goals} />
            <ul className="flex flex-col gap-2">
              {goals.map((g, i) => (
                <li key={i}>
                  <Notice tone={g.met ? "positive" : "warning"} as="div">
                    <GoalText g={g} />
                    {g.fix && (
                      <>
                        {" "}
                        <Link href={href([...changes, g.fix])} className={cn(LINK_CLASS, "whitespace-nowrap")}>
                          {T.tryIt}
                        </Link>
                      </>
                    )}
                  </Notice>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Αλλαγές: the list, each removable; save under a name; the ways to add one. */}
        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader
            as="h3"
            title={T.changes}
            actions={
              changes.length > 0 ? (
                <Link href={href([], { s: null })} className={cn(LINK_CLASS, "inline-flex min-h-11 items-center text-body")}>
                  {T.clear}
                </Link>
              ) : undefined
            }
          />
          {changes.length > 0 ? (
            <ul className="flex flex-col">
              {changes.map((c, i) => (
                <li key={i} className="flex min-h-11 items-center justify-between gap-3 border-b border-hairline py-2 text-body text-ink">
                  <span>{describe(c)}</span>
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

          {changes.length > 0 && (
            <form action={saveScenario} className="flex min-w-0 flex-wrap items-end gap-3">
              {months !== 12 && <input type="hidden" name="months" value={months} />}
              {current && <input type="hidden" name="id" value={current.id} />}
              {changes.map((c, i) => (
                <input key={i} type="hidden" name="c" value={encodeChange(c)} />
              ))}
              <Field label={T.saveName} htmlFor="save-name" className="min-w-0 flex-1 basis-56">
                <Input id="save-name" name="name" required maxLength={80} defaultValue={current?.name ?? ""} className="w-full" />
              </Field>
              <Button type="submit" variant="secondary">
                {current ? T.update : T.save}
              </Button>
              {current && (
                <Button type="submit" name="mode" value="new" variant="ghost">
                  {T.saveNew}
                </Button>
              )}
              {current && (
                <Button type="submit" formAction={deleteScenario} variant="ghost" className="text-negative">
                  {T.del}
                </Button>
              )}
            </form>
          )}

          <details open={changes.length === 0} className="group min-w-0">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">
                ▸
              </span>
              <span className="heading">{T.addChange}</span>
            </summary>
            <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 pt-2 lg:grid-cols-2">
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

              <AddForm title={T.ruleTitle} op="r" hidden={hidden}>
                <Field label={T.which} htmlFor="r-dir">
                  <Select id="r-dir" name="dir" defaultValue="e">
                    {Object.entries(RULE_DIRS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={T.project} htmlFor="r-p">
                  <Select id="r-p" name="p" defaultValue="-">
                    <option value="-">{T.allProjects}</option>
                    {forecastProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={T.only} htmlFor="r-u">
                  <Select id="r-u" name="u" defaultValue="a">
                    <option value="a">{T.all}</option>
                    <option value="u">{T.uncertainOnly}</option>
                  </Select>
                </Field>
                <Field label={T.action} htmlFor="r-op">
                  <Select id="r-op" name="ro" defaultValue="s3">
                    {SHIFTS.map((n) => (
                      <option key={`s${n}`} value={`s${n}`}>
                        {T.shiftText(n)}
                      </option>
                    ))}
                    <option value="d">{T.dropText}</option>
                    {PERCENTS.map((n) => (
                      <option key={`p${n}`} value={`p${n}`}>
                        {`${n > 0 ? "+" : "−"}${Math.abs(n)}% στο ποσό`}
                      </option>
                    ))}
                  </Select>
                </Field>
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
                <Field label={T.repeat} htmlFor="a-to">
                  <Select id="a-to" name="to" defaultValue="">
                    <option value="">{T.once}</option>
                    {monthKeys.slice(1).map((k) => (
                      <option key={k} value={k}>
                        {T.monthlyTo(shortMonthYearLabel(k))}
                      </option>
                    ))}
                    <option value="-">{T.monthlyEnd}</option>
                  </Select>
                </Field>
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
                  <Field label={T.direction} htmlFor="w-dir">
                    <Select id="w-dir" name="dir" defaultValue="out">
                      <option value="out">{T.toCash}</option>
                      <option value="in">{T.toBank}</option>
                    </Select>
                  </Field>
                  <Field label={T.amount} htmlFor="w-amt">
                    <MoneyInput id="w-amt" name="amt" required className="w-36" />
                  </Field>
                  <MonthSelect id="w-m" keys={monthKeys} />
                </AddForm>
              )}

              <AddForm title={T.goalTitle} op="g" hidden={hidden}>
                <Field label={T.goalKind} htmlFor="g-k">
                  <Select id="g-k" name="k" defaultValue={hasCash ? "c" : "b"}>
                    {hasCash && <option value="c">{T.cashFloorOpt}</option>}
                    <option value="b">{T.bankGoalOpt}</option>
                  </Select>
                </Field>
                <Field label={T.amount} htmlFor="g-amt">
                  <MoneyInput id="g-amt" name="amt" required className="w-36" />
                </Field>
                <MonthSelect id="g-m" keys={monthKeys} hint="για τις τράπεζες" />
              </AddForm>
            </div>
          </details>
        </section>

        <ReportChart
          title={T.balanceTitle}
          caption={`${months} ${t.months} · ${t.scenarios.base}${changed ? " · με τις αλλαγές και σήμερα" : ""}`}
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
          <MonthTable now={now} after={after} changed={changed} hasCash={hasCash} buffer={buf} />
        </ReportHistory>
      </ReportSection>
    </div>
  );
}

// ?op=… from one of the forms → the change, or null when a field is wrong.
function changeFromForm(op: string, sp: Record<string, string | string[] | undefined>, monthKeys: string[]): Change | null {
  const g = first(sp.g);
  const m = first(sp.m);
  const okMonth = !!m && monthKeys.includes(m);
  const amt = parseAmountInput(first(sp.amt) ?? null);
  const positive = amt !== null && amt > 0 ? amt : null;
  const label = (first(sp.label) ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (op === "s") {
    const n = Number(first(sp.n));
    return g && SHIFTS.includes(n) ? { t: "shift", g, n } : null;
  }
  if (op === "d") return g ? { t: "drop", g } : null;
  if (op === "r") {
    const dir = first(sp.dir);
    const p = first(sp.p) ?? "-";
    const ro = first(sp.ro) ?? "";
    if (dir !== "i" && dir !== "e" && dir !== "a") return null;
    const rule = { t: "rule" as const, dir: dir as RuleDir, project: p === "-" ? null : p, uncertain: first(sp.u) === "u" };
    if (ro === "d") return { ...rule, op: "d", n: 0 };
    const n = Number(ro.slice(1));
    if (ro[0] === "s" && SHIFTS.includes(n)) return { ...rule, op: "s", n };
    if (ro[0] === "p" && PERCENTS.includes(n)) return { ...rule, op: "p", n };
    return null;
  }
  if (op === "a" && okMonth && positive) {
    const amount = first(sp.dir) === "income" ? positive : -positive;
    const cash = first(sp.acc) === "c";
    const to = first(sp.to) ?? "";
    if (!to) return { t: "add", m: m!, amount, cash, label };
    if (to !== "-" && (!monthKeys.includes(to) || to < m!)) return null;
    return { t: "monthly", from: m!, to: to === "-" ? null : to, amount, cash, label };
  }
  if (op === "w" && okMonth && positive) return { t: "move", m: m!, amount: first(sp.dir) === "in" ? -positive : positive };
  if (op === "g" && positive) {
    if (first(sp.k) === "c") return { t: "cashFloor", amount: positive };
    if (okMonth) return { t: "bankGoal", m: m!, amount: positive };
  }
  return null;
}

function changeText(
  c: Change,
  ctx: { groups: Map<string, WhatIfGroup>; projects: Map<string, string>; items: WhatIfItem[] },
): string {
  const sources = el.reports.sources as Record<string, string>;
  switch (c.t) {
    case "shift":
    case "drop": {
      const g = ctx.groups.get(c.g);
      const name = g ? g.label || sources[g.source] || g.source : T.gone;
      return `${name}: ${c.t === "shift" ? T.shiftText(c.n) : T.dropText}`;
    }
    case "rule":
      return ruleText(c, ctx);
    case "add":
      return `${c.label || T.newAmount}: ${formatSignedMoney(c.amount)} · ${monthLabel(c.m)} · ${c.cash ? "μετρητά" : "τράπεζα"}`;
    case "monthly":
      return `${c.label || T.newAmount}: ${formatSignedMoney(c.amount)} τον μήνα · ${shortMonthYearLabel(c.from)}–${c.to ? shortMonthYearLabel(c.to) : "τέλος"} · ${c.cash ? "μετρητά" : "τράπεζα"}`;
    case "move":
      return c.amount > 0
        ? `Ανάληψη ${formatMoney(c.amount)} από τράπεζα σε μετρητά · ${monthLabel(c.m)}`
        : `Κατάθεση ${formatMoney(-c.amount)} μετρητών στην τράπεζα · ${monthLabel(c.m)}`;
    case "cashFloor":
      return `Στόχος: μετρητά πάντα πάνω από ${formatMoney(c.amount)}`;
    case "bankGoal":
      return `Στόχος: τράπεζες τουλάχιστον ${formatMoney(c.amount)} στο τέλος ${monthLabel(c.m)}`;
  }
}

function ruleText(r: RuleChange, ctx: { projects: Map<string, string>; items: WhatIfItem[] }): string {
  const what = [
    RULE_DIRS[r.dir],
    r.project ? `του έργου ${ctx.projects.get(r.project) ?? "—"}` : null,
    r.uncertain ? "(μόνο αβέβαιες)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const how = r.op === "d" ? T.dropText : r.op === "s" ? T.shiftText(r.n) : `${r.n > 0 ? "+" : "−"}${Math.abs(r.n)}% στο ποσό`;
  const n = ruleCount(r, ctx.items);
  return `${what}: ${how} · ${n} ${n === 1 ? "κίνηση" : "κινήσεις"}`;
}

function GoalText({ g }: { g: GoalResult }) {
  if (g.goal.t === "cashFloor") {
    if (g.met) return <>✓ Τα μετρητά μένουν πάνω από {formatMoney(g.goal.amount)} (χαμηλότερο {formatMoney(g.at?.cash ?? 0)}).</>;
    return (
      <>
        ⚠ Τα μετρητά πέφτουν στα {formatMoney(g.at?.cash ?? 0)} ({monthLabel(g.at?.month ?? "")}). Για να μένουν πάνω από{" "}
        {formatMoney(g.goal.amount)}: μεταφορά {formatMoney(g.fix?.amount ?? 0)} από την τράπεζα έως {monthLabel(g.fix?.m ?? "")}
        {g.afterFix !== null && <> — η τράπεζα μένει τουλάχιστον {formatMoney(g.afterFix)}</>}.
      </>
    );
  }
  const goal = g.goal;
  if (!g.at) return <>⚠ Ο μήνας του στόχου ({monthLabel(goal.m)}) είναι εκτός ορίζοντα.</>;
  const head = `Τράπεζες στο τέλος ${monthLabel(goal.m)}: ${formatMoney(g.at.bank)} · στόχος ${formatMoney(goal.amount)}`;
  if (g.met) return <>✓ {head}.</>;
  return (
    <>
      ⚠ {head} · λείπουν {formatMoney(g.gap)}.{" "}
      {g.fix ? (
        <>
          Κατάθεση {formatMoney(-g.fix.amount)} μετρητών έως {monthLabel(g.fix.m)} — τα μετρητά μένουν τουλάχιστον {formatMoney(g.afterFix ?? 0)}.
        </>
      ) : (
        <>Τα μετρητά δεν φτάνουν για να καλυφθεί.</>
      )}
    </>
  );
}

function SavedRow({
  name,
  href,
  summary,
  hasCash,
  active = false,
  muted = false,
}: {
  name: string;
  href: string;
  summary: ReturnType<typeof whatIfSummary>;
  hasCash: boolean;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <Tr aria-current={active ? "true" : undefined} className={active ? "bg-hover" : undefined}>
      <Td strong={!muted} className={cn(active && "!bg-hover")}>
        <Link href={href} className={cn(LINK_CLASS, "inline-flex items-center max-md:min-h-11", muted && "text-muted")}>
          {name}
        </Link>
      </Td>
      <Td numeric>
        {formatMoney(summary.lowest?.total ?? 0)}
        {summary.lowest && <span className="block text-small text-muted">{shortMonthYearLabel(summary.lowest.month)}</span>}
      </Td>
      <Td numeric className="hidden sm:table-cell">
        {formatMoney(summary.end?.total ?? 0)}
      </Td>
      {hasCash && (
        <Td className={cn("hidden md:table-cell", summary.cashOut && "text-negative")}>
          {summary.cashOut ? T.cashOut(shortMonthYearLabel(summary.cashOut.month)) : T.cashOk}
        </Td>
      )}
    </Tr>
  );
}

function MonthTable({
  now,
  after,
  changed,
  hasCash,
  buffer,
}: {
  now: WhatIfRow[];
  after: WhatIfRow[];
  changed: boolean;
  hasCash: boolean;
  buffer: number;
}) {
  const t = el.reports;
  return (
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
              <Td numeric strong className={cn("font-medium", r.total < buffer && "text-negative")}>
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
  );
}

function AddForm({ title, op, hidden, children }: { title: string; op: string; hidden: ReactNode; children: ReactNode }) {
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

function MonthSelect({ id, keys, hint }: { id: string; keys: string[]; hint?: string }) {
  return (
    <Field label={T.month} htmlFor={id} hint={hint}>
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
