import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Button, Input, Notice, PageHeader, Stat, cn } from "@/components/ui";
import { markInvoiceReceived } from "./actions";
import { currentYear, monthKeyOf, monthLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { syncStaleSchedule } from "../../projects/schedule-actions";

// Business-language framing for each check: not "amount_identity_mismatch"
// but why it matters and what to do about it. Ported from the workbook's
// Έλεγχοι Ποιότητας sheet, one check per row-render function since each
// underlying view has a different shape.
const CHECKS = [
  {
    view: "v_qc_account_drift" as const,
    title: "Υπόλοιπα που δεν συμφωνούν με την πραγματικότητα",
    why: "Η τελευταία μέτρηση (ταμείο ή τράπεζα) διαφέρει από αυτό που υπολογίζει η εφαρμογή — λείπουν ή περισσεύουν κινήσεις. Ή ο λογαριασμός δεν έχει μετρηθεί πάνω από 35 ημέρες, οπότε μια διαφορά δεν θα φαινόταν. Μην «διορθώνετε» το υπόλοιπο έναρξης· βρείτε τις κινήσεις.",
    render: (r: {
      account_id: string; account_name: string | null; counted_on: string | null;
      drift: number | null; days_since_count: number | null; issue: string | null;
    }) => (
      <Row key={r.account_id}>
        <Link href="/accounts" className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.account_name}
        </Link>
        {r.issue === "drift" && (
          <>
            <span className="text-small text-muted">μέτρηση {formatDate(r.counted_on)}</span>
            <Badge tone={Math.abs(Number(r.drift)) >= 50 ? "red" : "amber"}>
              {Number(r.drift) > 0 ? "+" : ""}
              {formatMoney(r.drift)} {Number(r.drift) > 0 ? "περισσότερα από την εφαρμογή" : "λιγότερα από την εφαρμογή"}
            </Badge>
          </>
        )}
        {r.issue === "stale" && <Badge tone="amber">χωρίς μέτρηση {r.days_since_count} ημέρες</Badge>}
        {r.issue === "never_counted" && <Badge tone="amber">δεν έχει μετρηθεί ποτέ</Badge>}
      </Row>
    ),
  },
  {
    view: "v_qc_counterparty_without_contact" as const,
    title: "Αντισυμβαλλόμενοι χωρίς επαφή",
    why: "Κινήσεις με όνομα αντισυμβαλλόμενου που δεν αντιστοιχεί σε επαφή — δεν εμφανίζονται στο ιστορικό προμηθευτή και δεν ελέγχεται ΑΦΜ. Δημιουργήστε την επαφή ή συνδέστε την κίνηση με υπάρχουσα.",
    render: (r: {
      counterparty_name: string; n: number | null; gross_amount: number | null;
      last_tx_date: string | null; transaction_ids: string[] | null;
    }) => (
      <Row key={r.counterparty_name}>
        <Link href={`/transactions?ids=${(r.transaction_ids ?? []).join(",")}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.counterparty_name}
        </Link>
        <span className="text-small text-muted">τελευταία {formatDate(r.last_tx_date)}</span>
        <span className="num">{formatMoney(r.gross_amount)}</span>
        <Badge tone="amber">{r.n}×</Badge>
      </Row>
    ),
  },
  {
    view: "v_qc_uninvoiced_large_expenses" as const,
    title: "Δαπάνες χωρίς παραστατικό (φορολογικός κίνδυνος)",
    why: "Επιχειρηματική δαπάνη πάνω από το όριο χωρίς παραστατικό δεν εκπίπτει και χάνεται ο ΦΠΑ· με μετρητά πάνω από το όριο δεν εκπίπτει ούτε με παραστατικό. Ζητήστε το παραστατικό από τον προμηθευτή.",
    render: (r: {
      transaction_id: string; paid_on: string | null; contact_name: string | null; description: string | null;
      project_name: string | null; gross_amount: number | null; risk_kind: string | null;
      lost_deduction_est: number | null; lost_input_vat_est: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.paid_on)}</span>
        <span className="min-w-0 flex-1 text-ink">
          {r.contact_name ?? r.description ?? "—"}
          {r.project_name && <span className="text-muted"> · {r.project_name}</span>}
        </span>
        <span className="num">{formatMoney(r.gross_amount)}</span>
        {r.risk_kind === "no_invoice" ? (
          <Badge tone="amber">χωρίς παραστατικό</Badge>
        ) : (
          <Badge tone="red">μετρητά &gt; όριο</Badge>
        )}
        <span className="text-small text-muted">
          χάνονται ~{formatMoney(Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0))}
        </span>
        {r.risk_kind === "no_invoice" && (
          <ArgsActionForm action={markInvoiceReceived} args={[r.transaction_id]} className="flex items-center gap-1">
            <Input name="invoice_number" placeholder="Αρ. παραστατικού" className="w-40" />
            <Button type="submit" variant="secondary" size="sm">
              Ήρθε
            </Button>
          </ArgsActionForm>
        )}
      </Row>
    ),
  },
  {
    view: "v_qc_missing_project_or_account" as const,
    title: "Κινήσεις χωρίς έργο ή λογαριασμό",
    why: "Χωρίς έργο, η κίνηση δεν μπαίνει σε κανένα P&L έργου. Χωρίς λογαριασμό, δεν προσμετράται στο υπόλοιπο κανενός λογαριασμού.",
    render: (r: {
      transaction_id: string; tx_date: string | null; description: string | null;
      contact_name: string | null; gross_amount: number | null;
      missing_project: boolean | null; missing_account: boolean | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num">{formatMoney(r.gross_amount)}</span>
        <span className="flex gap-1">
          {r.missing_project && <Badge tone="amber">χωρίς έργο</Badge>}
          {r.missing_account && <Badge tone="amber">χωρίς λογαριασμό</Badge>}
        </span>
      </Row>
    ),
  },
  {
    view: "v_qc_vat_mismatch" as const,
    title: "ΦΠΑ που δεν ταιριάζει με τον συντελεστή",
    why: "Το καταχωρημένο ΦΠΑ διαφέρει από καθαρή αξία × συντελεστή πάνω από 2 λεπτά — πιθανό λάθος πληκτρολόγησης.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      description: string | null; net_amount: number | null; vat_amount: number | null;
      expected_vat: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num">
          {formatMoney(r.vat_amount)} <span className="text-muted">αντί</span>{" "}
          {formatMoney(r.expected_vat)}
        </span>
      </Row>
    ),
  },
  {
    view: "v_qc_amount_identity_mismatch" as const,
    title: "Καθαρή + ΦΠΑ − Παρακράτηση ≠ Σύνολο",
    why: "Η βασική ταυτότητα της κίνησης δεν ισοσκελίζει — το σύνολο δεν προκύπτει από τα επιμέρους ποσά.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      description: string | null; expected_gross: number | null; gross_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num">
          {formatMoney(r.gross_amount)} <span className="text-muted">αντί</span>{" "}
          {formatMoney(r.expected_gross)}
        </span>
      </Row>
    ),
  },
  {
    view: "v_qc_duplicate_fingerprints" as const,
    title: "Πιθανά διπλότυπες κινήσεις",
    why: "Ίδια ημερομηνία, ΑΦΜ και ποσό εμφανίζονται σε περισσότερες από μία κινήσεις — πιθανή διπλή καταχώρηση.",
    render: (r: {
      fingerprint: string; tx_dates: (string | null)[] | null;
      contact_names: (string | null)[] | null; amounts: (number | null)[] | null; n: number | null;
    }) => (
      <Row key={r.fingerprint}>
        <span className="min-w-0 flex-1 text-ink">{(r.contact_names ?? []).filter(Boolean).join(", ") || "—"}</span>
        <span>{(r.tx_dates ?? []).map((d) => formatDate(d)).join(", ")}</span>
        <span className="num">{formatMoney((r.amounts ?? [])[0])}</span>
        <Badge tone="amber">{r.n}× ίδια</Badge>
      </Row>
    ),
  },
  {
    view: "v_qc_duplicate_invoice_numbers" as const,
    title: "Διπλότυπος αριθμός παραστατικού",
    why: "Το ίδιο Αρ. Παραστατικού χρησιμοποιείται σε περισσότερες από μία κινήσεις.",
    render: (r: {
      invoice_number: string | null; tx_dates: (string | null)[] | null;
      contact_names: (string | null)[] | null; n: number | null;
    }) => (
      <Row key={r.invoice_number}>
        <span className="num">{r.invoice_number}</span>
        <span className="min-w-0 flex-1 text-ink">{(r.contact_names ?? []).filter(Boolean).join(", ") || "—"}</span>
        <span>{(r.tx_dates ?? []).map((d) => formatDate(d)).join(", ")}</span>
        <Badge tone="amber">{r.n}×</Badge>
      </Row>
    ),
  },
  {
    view: "v_qc_afm_mismatch" as const,
    title: "ΑΦΜ κίνησης ≠ ΑΦΜ επαφής",
    why: "Το ΑΦΜ πάνω στο παραστατικό διαφέρει από το καταχωρημένο ΑΦΜ της συνδεδεμένης επαφής — ελέγξτε ποιο είναι σωστό.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      counterparty_afm: string | null; contact_afm: string | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name}</span>
        <span className="num text-small">
          κίνηση: {r.counterparty_afm} <span className="text-muted">/</span> επαφή: {r.contact_afm}
        </span>
      </Row>
    ),
  },
  {
    view: "v_qc_future_dated" as const,
    title: "Μελλοντικές κινήσεις (μη προγραμματισμένες)",
    why: "Η ημερομηνία είναι στο μέλλον αλλά η κίνηση δεν έχει σημανθεί ως «Προγραμματισμένο» — πιθανό λάθος ημερομηνίας.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      description: string | null; gross_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num">{formatMoney(r.gross_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_non_positive_amounts" as const,
    title: "Μη θετικά ποσά",
    why: "Το σύνολο μιας κίνησης είναι μηδέν ή αρνητικό — τα ποσά πρέπει πάντα να είναι θετικά, η κατεύθυνση δείχνει έσοδο ή έξοδο.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      description: string | null; gross_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num text-negative">{formatMoney(r.gross_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_withholding_on_income" as const,
    title: "Παρακράτηση σε έσοδο",
    why: "Παρακράτηση φόρου καταχωρήθηκε σε κίνηση εσόδου — σπάνιο αλλά νόμιμο (π.χ. πελάτης σας παρακράτησε φόρο). Επιβεβαιώστε ότι είναι σωστό.",
    render: (r: {
      transaction_id: string; tx_date: string | null; contact_name: string | null;
      description: string | null; withholding_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <span className="min-w-0 flex-1 text-ink">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="num">{formatMoney(r.withholding_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_contacts_missing_afm" as const,
    title: "Επαφές χωρίς ΑΦΜ",
    why: "Χωρίς ΑΦΜ, μια επαφή δεν μπορεί να ταυτοποιηθεί αυτόματα σε μελλοντική εισαγωγή AADE.",
    render: (r: { contact_id: string; name: string | null; phone: string | null }) => (
      <Row key={r.contact_id}>
        <Link href={`/contacts/${r.contact_id}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.name}
        </Link>
        <span className="text-muted">{r.phone ?? ""}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_duplicate_contact_afm" as const,
    title: "Διπλότυπο ΑΦΜ σε επαφές",
    why: "Το ίδιο ΑΦΜ υπάρχει σε περισσότερες από μία επαφές — πιθανόν ο ίδιος προμηθευτής/πελάτης καταχωρήθηκε δύο φορές.",
    render: (r: { afm: string | null; contact_names: (string | null)[] | null; n: number | null }) => (
      <Row key={r.afm}>
        <span className="num">{r.afm}</span>
        <span className="min-w-0 flex-1 text-ink">{(r.contact_names ?? []).join(", ")}</span>
        <Badge tone="amber">{r.n}×</Badge>
      </Row>
    ),
  },
  {
    view: "v_qc_capex_to_lessor" as const,
    title: "Επένδυση (capex) πληρωμένη στον εκμισθωτή",
    why: "Δαπάνη με κατηγορία «επένδυση» προς επαφή που είναι και ο εκμισθωτής (ενοίκιο ή διακανονισμός) του ίδιου έργου — συνήθως είναι ενοίκιο ή συμψηφισμός, όχι επένδυση.",
    render: (r: {
      transaction_id: string | null; tx_date: string | null; contact_name: string | null;
      project_name: string | null; gross_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <Link href={`/transactions?ids=${r.transaction_id}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.contact_name ?? "—"} <span className="text-muted">· {r.project_name ?? "—"}</span>
        </Link>
        <span className="num">{formatMoney(r.gross_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_spend_without_treatment" as const,
    title: "Δαπάνες έργου χωρίς λογιστική μεταχείριση",
    why: "Η κατηγορία λείπει ή δεν δηλώνει αν είναι επένδυση, λειτουργικό κόστος κ.λπ. — η δαπάνη δεν κατανέμεται σωστά στον προϋπολογισμό του έργου.",
    render: (r: {
      transaction_id: string | null; tx_date: string | null; description: string | null;
      project_name: string | null; gross_amount: number | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.tx_date)}</span>
        <Link href={`/transactions?ids=${r.transaction_id}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.description ?? "—"} <span className="text-muted">· {r.project_name ?? "—"}</span>
        </Link>
        <span className="num">{formatMoney(r.gross_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_schedule_stale" as const,
    title: "Προγράμματα δανείων/μισθώσεων που δεν έχουν περάσει στο ταμείο",
    why: "Το δάνειο ή η μίσθωση άλλαξε (ή δεν έχει συγχρονιστεί ποτέ) μετά την τελευταία εγγραφή των δόσεων στις κινήσεις, οπότε η πρόβλεψη ταμείου δεν δείχνει τις σωστές πληρωμές. Ο συγχρονισμός ξαναγράφει μόνο τις απλήρωτες δόσεις.",
    render: (r: { kind: string | null; source_id: string | null; project_id: string | null; label: string | null }) => (
      <Row key={`${r.kind}:${r.source_id}`}>
        <Link href={r.project_id ? `/projects/${r.project_id}` : "/projects"} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.label ?? "—"}
        </Link>
        <Badge tone="amber">{r.kind === "loan" ? "δάνειο" : "μίσθωση"}</Badge>
        <ArgsActionForm action={syncStaleSchedule} args={[r.kind ?? "loan", r.source_id ?? ""]}>
          <Button type="submit" variant="secondary" size="sm">
            Συγχρονισμός
          </Button>
        </ArgsActionForm>
      </Row>
    ),
  },
  {
    view: "v_qc_forecast_stale" as const,
    title: "Παλιές εγγραφές που μεταφέρονται στην πρόβλεψη ταμείου",
    why: "Εκταμιεύσεις, αναμενόμενα έσοδα, συμφωνίες ή εκκρεμείς κινήσεις που έπρεπε να έχουν γίνει και η πρόβλεψη τις μεταφέρει στον τρέχοντα μήνα. Σημειώστε τες ως πραγματοποιημένες, αλλάξτε την ημερομηνία ή ακυρώστε τες.",
    render: (r: {
      source: string | null; ref_id: string | null; label: string | null; due_date: string | null;
      direction: string | null; amount: number | null;
    }) => (
      <Row key={`${r.source}:${r.ref_id}:${r.due_date}`}>
        <span>{formatDate(r.due_date)}</span>
        <span className="min-w-0 flex-1 text-ink">
          {r.label || "—"}{" "}
          <span className="text-muted">· {el.reports.sources[r.source as keyof typeof el.reports.sources] ?? r.source}</span>
        </span>
        <span className="num">
          {r.direction === "income" ? "+" : "−"}
          {formatMoney(Math.abs(Number(r.amount ?? 0)))}
</span>
      </Row>
    ),
  },
  {
    view: "v_qc_expected_vs_scheduled" as const,
    title: "Αναμενόμενα που υπάρχουν ήδη ως κίνηση",
    why: "Το ίδιο ποσό, τον ίδιο μήνα, είναι και αναμενόμενο έσοδο και εκκρεμής ή προγραμματισμένη κίνηση· η πρόβλεψη ταμείου το μετρά δύο φορές. Αν είναι το ίδιο, σημειώστε το αναμενόμενο ως «Εισπράχθηκε» ή «Δεν θα έρθει» στο Ταμείο.",
    render: (r: {
      expected_id: string | null; transaction_id: string | null; source: string | null; expected_month: string | null;
      expected_amount: number | null; tx_label: string | null; tx_due_date: string | null; direction: string | null;
    }) => (
      <Row key={`${r.expected_id}:${r.transaction_id}`}>
        <span className="whitespace-nowrap">{r.expected_month ? monthLabel(monthKeyOf(r.expected_month)) : "—"}</span>
        <span className="min-w-0 flex-1 text-ink">
          <Link href="/reports/cash" className="underline-offset-4 hover:underline">{r.source ?? "—"}</Link>
          <span className="text-muted"> = </span>
          <Link href={`/transactions?ids=${r.transaction_id}`} className="underline-offset-4 hover:underline">
            {r.tx_label ?? "—"}
          </Link>
          <span className="text-muted"> · {formatDate(r.tx_due_date)}</span>
        </span>
        <span className="num">
          {r.direction === "expense" ? "−" : "+"}
          {formatMoney(r.expected_amount)}
        </span>
      </Row>
    ),
  },
  {
    view: "v_qc_loan_without_interest" as const,
    title: "Δόσεις δανείου χωρίς τόκο",
    why: "Από μια δόση δανείου τα Αποτελέσματα μετρούν μόνο τον τόκο. Χωρίς τόκο στη δόση, το κόστος του δανείου λείπει από το αποτέλεσμα και όλο το ποσό λογίζεται ως κεφάλαιο. Συμπληρώστε τον τόκο στην κίνηση ή συγχρονίστε το πρόγραμμα του δανείου.",
    render: (r: {
      transaction_id: string | null; loan_label: string | null; due_date: string | null; gross_amount: number | null;
      project_id: string | null;
    }) => (
      <Row key={r.transaction_id}>
        <span>{formatDate(r.due_date)}</span>
        <Link href={`/transactions?ids=${r.transaction_id}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.loan_label ?? "—"}
        </Link>
        <span className="num">{formatMoney(r.gross_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_projects_without_budget" as const,
    title: "Έργα χωρίς προϋπολογισμό",
    why: "Χωρίς προϋπολογισμό, το έργο δεν έχει σημείο αναφοράς για «πόσο απομένει» ή «πόσο υπερβήκαμε».",
    render: (r: { project_id: string; display_name: string | null }) => (
      <Row key={r.project_id}>
        <Link href={`/projects/${r.project_id}`} className="min-w-0 flex-1 text-ink underline-offset-4 hover:underline">
          {r.display_name}
        </Link>
      </Row>
    ),
  },
];

export default async function QualityPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const results = await Promise.all(
    CHECKS.map(async (check) => {
      const { data, count } = await supabase
        .from(check.view)
        .select("*", { count: "exact" })
        .eq("org_id", orgId)
        .limit(20);
      return { ...check, rows: data ?? [], count: count ?? 0 };
    }),
  );

  const totalIssues = results.reduce((sum, r) => sum + r.count, 0);

  const { data: exposureRows } = await supabase
    .from("v_uninvoiced_exposure")
    .select("gross_amount, lost_deduction_est, lost_input_vat_est, month")
    .eq("org_id", orgId);
  const thisYear = String(currentYear());
  const exposure = (exposureRows ?? []).reduce(
    (acc, r) => {
      const lost = Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0);
      acc.gross += Number(r.gross_amount ?? 0);
      acc.lost += lost;
      if (r.month?.startsWith(thisYear)) acc.lostThisYear += lost;
      return acc;
    },
    { gross: 0, lost: 0, lostThisYear: 0 },
  );

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            Έλεγχοι Ποιότητας
            <Badge tone={totalIssues === 0 ? "neutral" : "amber"}>
              {totalIssues === 0 ? "Όλα εντάξει" : `${totalIssues} ευρήματα`}
            </Badge>
          </span>
        }
        meta={
          <span className="block max-w-3xl">
            Αυτόματοι έλεγχοι πάνω στα δεδομένα σας, ώστε να εντοπίζονται λάθη πριν γίνουν πρόβλημα
            στο ΦΠΑ ή στα οικονομικά των έργων.
          </span>
        }
      />

      {exposure.gross > 0 && (
        <Notice tone="warning" as="section" className="flex flex-col gap-4">
          <h2 className="text-body text-ink">Εκτιμώμενη φορολογική απώλεια από δαπάνες χωρίς παραστατικό</h2>
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <Stat label="Δαπάνες" value={formatMoney(exposure.gross)} />
            <Stat label="Χαμένος φόρος + ΦΠΑ" value={<span className="font-normal">{formatMoney(exposure.lost)}</span>} />
            <Stat label="Φέτος" value={formatMoney(exposure.lostThisYear)} />
          </div>
          <p className="text-small text-muted">
            Εκτίμηση με το όριο και τον συντελεστή των Ρυθμίσεων — επιβεβαιώστε με τον λογιστή.
          </p>
        </Notice>
      )}

      <div className="flex flex-col border-t border-hairline">
        {results.map((check) => (
          <section
            key={check.view}
            className={cn(
              "flex min-w-0 flex-col gap-2 border-b border-hairline py-5 pr-1",
              check.count > 0 ? "border-l-2 border-l-warning pl-4" : "border-l-2 border-l-transparent pl-4",
            )}
          >
            <div className="flex items-baseline gap-3">
              <h2 className="text-body text-ink">{check.title}</h2>
              <Badge tone={check.count === 0 ? "neutral" : "amber"} className="num">
                {check.count}
              </Badge>
            </div>
            <p className="max-w-3xl text-small text-muted">{check.why}</p>
            {check.count > 0 && (
              <div className="mt-1 flex flex-col border-t border-hairline text-body">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(check.rows as any[]).map((r) => check.render(r as never))}
                {check.count > check.rows.length && (
                  <p className="pt-2 text-small text-muted">
                    … και {check.count - check.rows.length} ακόμα
                  </p>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline py-2 text-text">
      {children}
    </div>
  );
}
