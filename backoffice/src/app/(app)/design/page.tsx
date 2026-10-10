import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAccessContext } from "@/lib/supabase/access";
import { formatMoney } from "@/lib/format";
import { SECTION_TABS } from "@/lib/navigation";
import { withParams } from "@/lib/url";
import {
  AiSpark,
  Amount,
  Badge,
  Brand,
  Button,
  ButtonLink,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FilterChip,
  GlancePanel,
  Input,
  KeyValue,
  LogoMark,
  MenuItem,
  MenuLink,
  MetaList,
  MoneyInput,
  PageHeader,
  PageSkeleton,
  SectionHeader,
  Segmented,
  Select,
  Skeleton,
  Sparkline,
  Stat,
  StatRow,
  StatusDot,
  Tabs,
  Textarea,
  ToastProvider,
  Toolbar,
  Worklist,
  WorklistItem,
  type Column,
} from "@/components/ui";
import { color, contrast, CONTRAST_PAIRS, cssName, type as typeScale, type ColorToken } from "@/components/ui/tokens";
import { ChartDemo, OverlayDemos } from "./DesignDemos";
import { DEMO_CASH, DEMO_KEY_VALUE, DEMO_STATUS_LABEL, DEMO_STATUS_TONE, DEMO_TX, DEMO_WORKLIST, type DemoTx } from "./fixtures";

// /design: the design system on one page, for owners and admins (not in
// any menu). Every token with its live WCAG ratio, the type scale, every
// component and its states, on made-up data. If something looks wrong
// here it looks wrong everywhere.

export const metadata: Metadata = {
  title: "Design system — Kansha",
  robots: { index: false, follow: false },
};

const GROUPS: { title: string; tokens: ColorToken[] }[] = [
  { title: "Επιφάνειες", tokens: ["canvas", "raised", "field", "hover", "frame"] },
  { title: "Κείμενο", tokens: ["ink", "text", "muted"] },
  { title: "Γραμμές", tokens: ["hairline", "chipBorder", "fieldBorder", "rule"] },
  { title: "Μάρκα", tokens: ["navy", "navyStrong", "accent", "accentInk"] },
  { title: "Πάνελ", tokens: ["panel", "panelInk", "panelMuted"] },
  {
    title: "Σημασιολογικά",
    tokens: ["positive", "positiveTint", "negative", "negativeTint", "warning", "warningTint", "ai", "aiTint"],
  },
];

const TX_COLUMNS: Column<DemoTx>[] = [
  { key: "date", header: "Ημ/νία", cell: (r) => r.date, numeric: true, hideOnCard: true },
  { key: "description", header: "Περιγραφή", cell: (r) => r.description, primary: true },
  { key: "contact", header: "Επαφή", cell: (r) => r.contact },
  { key: "project", header: "Έργο", cell: (r) => r.project, hideOnCard: true },
  {
    key: "status",
    header: "Κατάσταση",
    cell: (r) => <StatusDot tone={DEMO_STATUS_TONE[r.status]} label={DEMO_STATUS_LABEL[r.status]} />,
  },
  { key: "amount", header: "Ποσό", cell: (r) => <Amount value={r.amount} format={formatMoney} />, numeric: true },
];

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <SectionHeader numeral={n} title={title} />
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="eyebrow text-muted">{children}</p>;
}

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ chip?: string; view?: string }> }) {
  const access = await getAccessContext();
  if (access.kind !== "internal" || !["owner", "admin"].includes(access.membership.role)) notFound();
  const params = await searchParams;
  const chip = params.chip ?? "all";
  const view = params.view ?? "board";
  const total = DEMO_TX.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="flex flex-col gap-14">
      <PageHeader
        eyebrow="Εσωτερικό"
        title="Design system"
        meta={<MetaList items={["P15 Light Blue", "Inter", `${CONTRAST_PAIRS.length} έλεγχοι αντίθεσης`]} />}
        actions={
          <>
            <Button variant="secondary">Δευτερεύον</Button>
            <Button>Κύριο</Button>
          </>
        }
        overflow={
          <>
            <MenuItem>Εξαγωγή</MenuItem>
            <MenuLink href="/settings">Ρυθμίσεις</MenuLink>
          </>
        }
      />

      <Section n={1} title="Χρώματα">
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-3">
            <Label>{g.title}</Label>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
              {g.tokens.map((t) => (
                <li key={t} className="flex flex-col gap-1.5">
                  <span className="h-14 border border-hairline" style={{ background: color[t] }} />
                  <span className="text-sm text-ink">{cssName(t)}</span>
                  <span className="num text-xs text-muted">{color[t]}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section n={2} title="Αντίθεση (WCAG, ζωντανά)">
        <DataTable
          mode="scroll"
          rowKey={(p) => `${p.fg}/${p.bg}`}
          rows={CONTRAST_PAIRS.map((p) => ({ ...p, ratio: contrast(color[p.fg], color[p.bg]) }))}
          columns={[
            {
              key: "sample",
              header: "Δείγμα",
              cell: (p) => (
                <span className="inline-block px-2 py-1" style={{ background: color[p.bg], color: color[p.fg] }}>
                  Αα 1.234,56
                </span>
              ),
            },
            { key: "pair", header: "Χρώμα / φόντο", cell: (p) => `${cssName(p.fg)} / ${cssName(p.bg)}` },
            { key: "use", header: "Χρήση", cell: (p) => p.use },
            { key: "ratio", header: "Λόγος", cell: (p) => `${p.ratio.toFixed(2)}:1`, numeric: true },
            { key: "min", header: "Ελάχ.", cell: (p) => `${p.min}:1`, numeric: true },
            {
              key: "ok",
              header: "",
              cell: (p) =>
                p.ratio >= p.min ? <Badge tone="positive">AA</Badge> : <Badge tone="negative">Αποτυχία</Badge>,
            },
          ]}
        />
      </Section>

      <Section n={3} title="Τυπογραφία">
        <div className="flex flex-col">
          {Object.entries(typeScale).map(([name, [size, lh, weight]]) => (
            <div key={name} className="flex flex-col gap-1 border-b border-hairline py-4 md:flex-row md:items-baseline md:gap-8">
              <span className="num w-44 shrink-0 text-xs text-muted">
                {name} · {size}/{lh} · {weight}
              </span>
              <span
                className={name === "eyebrow" ? "eyebrow text-ink" : "text-ink"}
                style={name === "eyebrow" ? undefined : { fontSize: size, lineHeight: lh, fontWeight: weight }}
              >
                {name.startsWith("figure") || name === "numeral" ? <span className="num">+12.400,00 €</span> : "Ταμείο τώρα, ορίζοντας 12 μηνών"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section n={4} title="Μάρκα">
        <div className="flex flex-wrap items-center gap-10">
          <Brand />
          <Brand compact />
          <span className="text-accent">
            <LogoMark size={48} />
          </span>
          <span className="bg-panel p-4 text-panel-ink">
            <LogoMark size={32} />
          </span>
        </div>
      </Section>

      <Section n={5} title="Κουμπιά και σήματα">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Κύριο</Button>
            <Button variant="secondary">Δευτερεύον</Button>
            <Button variant="ghost">Απλό</Button>
            <Button variant="danger">Διαγραφή</Button>
            <Button variant="ai">
              <AiSpark /> Ρώτα το Kansha
            </Button>
            <Button disabled>Ανενεργό</Button>
            <ButtonLink href="/design">Σύνδεσμος</ButtonLink>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Μικρό κύριο</Button>
            <Button size="sm" variant="secondary">
              Μικρό
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Ουδέτερο</Badge>
            <Badge tone="positive">Πληρωμένη</Badge>
            <Badge tone="warning">Εκκρεμεί</Badge>
            <Badge tone="negative">Ληξιπρόθεσμη</Badge>
            <Badge tone="ai">
              <AiSpark className="h-3 w-3" /> AI
            </Badge>
            <Badge tone="navy">Βάση</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <StatusDot tone="positive" label="Σε τροχιά" />
            <StatusDot tone="warning" label="Καθυστέρηση" />
            <StatusDot tone="negative" label="Εκτός προϋπολογισμού" />
            <StatusDot tone="neutral" label="Σε αναμονή" />
          </div>
        </div>
      </Section>

      <Section n={6} title="Πεδία">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Περιγραφή" htmlFor="f1" hint="Όπως στο παραστατικό">
            <Input id="f1" placeholder="π.χ. ΔΕΗ Οκτωβρίου" />
          </Field>
          <Field label="Ποσό" htmlFor="f2">
            <MoneyInput id="f2" defaultValue="1.250,00" />
          </Field>
          <Field label="Λογαριασμός" htmlFor="f3">
            <Select id="f3" defaultValue="a">
              <option value="a">Eurobank όψεως</option>
              <option value="b">Πειραιώς</option>
            </Select>
          </Field>
          <Field label="ΑΦΜ" htmlFor="f4" error="Ο ΑΦΜ έχει 9 ψηφία.">
            <Input id="f4" defaultValue="12345" aria-invalid="true" />
          </Field>
          <Field label="Ανενεργό" htmlFor="f5">
            <Input id="f5" defaultValue="Κλειδωμένο" disabled />
          </Field>
          <Field label="Σημειώσεις" htmlFor="f6">
            <Textarea id="f6" defaultValue="Πληρώνεται σε δύο δόσεις." />
          </Field>
          <Checkbox label="Έχει τιμολόγιο" defaultChecked />
        </div>
      </Section>

      <Section n={7} title="Κεφαλίδες και στοιχεία">
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Label>SectionHeader · MetaList</Label>
            <SectionHeader numeral={2} title="Σύμβαση πελάτη" actions={<Button size="sm" variant="secondary">Επεξεργασία</Button>} />
            <MetaList items={["Έργο", "P15 Residences", "Διαμέρισμα Β2", "5 κινήσεις"]} />
          </div>
          <div className="flex flex-col gap-4">
            <Label>KeyValue</Label>
            <KeyValue items={DEMO_KEY_VALUE} />
          </div>
        </div>
      </Section>

      <Section n={8} title="Νούμερα και «Με μια ματιά»">
        <div className="grid gap-8 lg:grid-cols-[1fr_var(--spacing-glance)]">
          <div className="flex flex-col gap-6">
            <StatRow>
              <Stat label="Ταμείο τώρα" value="61.300,00 €" sub="+2.700,00 € από τον Σεπτέμβριο" size="lg" />
              <Stat label="Απαιτήσεις" value="+18.650,00 €" sub="4 ανοιχτές" />
              <Stat label="Υποχρεώσεις" value="−9.412,40 €" sub="7 ανοιχτές" />
              <Stat label="Ελάχιστο 12μήνου" value="47.900,00 €" sub="Αύγουστος" />
            </StatRow>
            <div className="flex items-center gap-4">
              <Sparkline values={DEMO_CASH.map((d) => d.cash)} label="Ταμείο, τελευταίοι 12 μήνες" width={160} height={40} />
              <Sparkline values={[3, -2, -5, 1, 4, 2, -1]} label="Καθαρή ροή" width={160} height={40} />
            </div>
          </div>
          <GlancePanel
            items={[
              { label: "Επένδυση", value: "1.240.000 €" },
              { label: "Δαπανήθηκε", value: "812.400 €", sub: "65% του προϋπολογισμού" },
              { label: "IRR βάσης", value: "14,2%" },
            ]}
            footer={
              <div className="flex items-center justify-between gap-3">
                <span>Ταμείο έργου</span>
                <Sparkline onPanel values={DEMO_CASH.map((d) => d.plan)} label="Ταμείο έργου" />
              </div>
            }
          />
        </div>
      </Section>

      <Section n={9} title="Φίλτρα και καρτέλες">
        <Toolbar
          label="Φίλτρα κινήσεων"
          actions={<Button size="sm" variant="secondary">Αποθήκευση φίλτρου</Button>}
        >
          {[
            ["all", "Όλες", 48],
            ["pending", "Εκκρεμείς", 7],
            ["paid", "Πληρωμένες", 41],
          ].map(([key, label, count]) => (
            <FilterChip
              key={key}
              href={withParams("/design", params, { chip: key === "all" ? null : String(key) })}
              active={chip === key}
              count={Number(count)}
            >
              {label}
            </FilterChip>
          ))}
        </Toolbar>
        <Segmented
          label="Προβολή"
          active={view}
          options={[
            { key: "board", label: "Πίνακας", href: withParams("/design", params, { view: null }) },
            { key: "timeline", label: "Χρονοδιάγραμμα", href: withParams("/design", params, { view: "timeline" }) },
            { key: "calendar", label: "Ημερολόγιο", href: withParams("/design", params, { view: "calendar" }) },
          ]}
        />
        <Tabs tabs={SECTION_TABS.reports} label="Αναφορές" />
      </Section>

      <Section n={10} title="Πίνακας">
        <Label>Στον υπολογιστή πίνακας, στο κινητό κάρτες · μενού «⋯» ανά γραμμή · σύνολο</Label>
        <DataTable
          rows={DEMO_TX}
          columns={TX_COLUMNS}
          rowKey={(r) => r.id}
          rowHref={() => "/design"}
          rowActions={() => (
            <>
              <MenuItem>Επεξεργασία</MenuItem>
              <MenuItem>Μερική πληρωμή</MenuItem>
              <MenuItem tone="danger">Διαγραφή</MenuItem>
            </>
          )}
          totals={{ amount: <Amount value={total} format={formatMoney} /> }}
        />
        <Label>mode=&quot;scroll&quot; (αναφορές) και κενός πίνακας</Label>
        <DataTable rows={DEMO_TX.slice(0, 2)} columns={TX_COLUMNS} rowKey={(r) => r.id} mode="scroll" />
        <DataTable rows={[] as DemoTx[]} columns={TX_COLUMNS} rowKey={(r) => r.id} />
      </Section>

      <Section n={11} title="Να γίνουν">
        <Worklist label="Να γίνουν">
          {DEMO_WORKLIST.map((w) => (
            <WorklistItem key={w.title} {...w} />
          ))}
        </Worklist>
      </Section>

      <Section n={12} title="Γράφημα">
        <ChartDemo />
      </Section>

      <Section n={13} title="Συρτάρι, παράθυρο, μενού, toast">
        <ToastProvider>
          <OverlayDemos />
        </ToastProvider>
      </Section>

      <Section n={14} title="Κενό και φόρτωση">
        <EmptyState
          title="Δεν υπάρχουν κινήσεις με αυτά τα φίλτρα"
          body="Αλλάξτε την περίοδο ή καθαρίστε τα φίλτρα για να δείτε όλες τις κινήσεις."
          action={<ButtonLink href="/design">Καθαρισμός φίλτρων</ButtonLink>}
        />
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <PageSkeleton rows={3} />
      </Section>
    </div>
  );
}
