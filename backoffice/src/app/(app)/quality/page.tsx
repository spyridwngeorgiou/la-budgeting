import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui";

// Business-language framing for each check: not "amount_identity_mismatch"
// but why it matters and what to do about it. Ported from the workbook's
// Έλεγχοι Ποιότητας sheet, one check per row-render function since each
// underlying view has a different shape.
const CHECKS = [
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono">{formatMoney(r.gross_amount)}</span>
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono">
          {formatMoney(r.vat_amount)} <span className="text-ink-faint">αντί</span>{" "}
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono">
          {formatMoney(r.gross_amount)} <span className="text-ink-faint">αντί</span>{" "}
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
        <span className="flex-1">{(r.contact_names ?? []).filter(Boolean).join(", ") || "—"}</span>
        <span>{(r.tx_dates ?? []).map((d) => formatDate(d)).join(", ")}</span>
        <span className="font-mono">{formatMoney((r.amounts ?? [])[0])}</span>
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
        <span className="font-mono">{r.invoice_number}</span>
        <span className="flex-1">{(r.contact_names ?? []).filter(Boolean).join(", ") || "—"}</span>
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
        <span className="flex-1">{r.contact_name}</span>
        <span className="font-mono text-xs">
          κίνηση: {r.counterparty_afm} <span className="text-ink-faint">/</span> επαφή: {r.contact_afm}
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono">{formatMoney(r.gross_amount)}</span>
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono text-red-ink">{formatMoney(r.gross_amount)}</span>
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
        <span className="flex-1">{r.contact_name ?? r.description ?? "—"}</span>
        <span className="font-mono">{formatMoney(r.withholding_amount)}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_contacts_missing_afm" as const,
    title: "Επαφές χωρίς ΑΦΜ",
    why: "Χωρίς ΑΦΜ, μια επαφή δεν μπορεί να ταυτοποιηθεί αυτόματα σε μελλοντική εισαγωγή AADE.",
    render: (r: { contact_id: string; name: string | null; phone: string | null }) => (
      <Row key={r.contact_id}>
        <Link href={`/contacts/${r.contact_id}`} className="flex-1 hover:underline">
          {r.name}
        </Link>
        <span className="text-ink-faint">{r.phone ?? ""}</span>
      </Row>
    ),
  },
  {
    view: "v_qc_duplicate_contact_afm" as const,
    title: "Διπλότυπο ΑΦΜ σε επαφές",
    why: "Το ίδιο ΑΦΜ υπάρχει σε περισσότερες από μία επαφές — πιθανόν ο ίδιος προμηθευτής/πελάτης καταχωρήθηκε δύο φορές.",
    render: (r: { afm: string | null; contact_names: (string | null)[] | null; n: number | null }) => (
      <Row key={r.afm}>
        <span className="font-mono">{r.afm}</span>
        <span className="flex-1">{(r.contact_names ?? []).join(", ")}</span>
        <Badge tone="amber">{r.n}×</Badge>
      </Row>
    ),
  },
  {
    view: "v_qc_projects_without_budget" as const,
    title: "Έργα χωρίς προϋπολογισμό",
    why: "Χωρίς προϋπολογισμό, το έργο δεν έχει σημείο αναφοράς για «πόσο απομένει» ή «πόσο υπερβήκαμε».",
    render: (r: { project_id: string; display_name: string | null }) => (
      <Row key={r.project_id}>
        <Link href={`/projects/${r.project_id}`} className="flex-1 hover:underline">
          {r.display_name}
        </Link>
      </Row>
    ),
  },
];

export default async function QualityPage() {
  const supabase = await createClient();

  const results = await Promise.all(
    CHECKS.map(async (check) => {
      const { data, count } = await supabase
        .from(check.view)
        .select("*", { count: "exact" })
        .limit(20);
      return { ...check, rows: data ?? [], count: count ?? 0 };
    }),
  );

  const totalIssues = results.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Έλεγχοι Ποιότητας</h1>
        <Badge tone={totalIssues === 0 ? "green" : "amber"}>
          {totalIssues === 0 ? "Όλα εντάξει" : `${totalIssues} ευρήματα`}
        </Badge>
      </div>
      <p className="text-sm text-ink-muted">
        Αυτόματοι έλεγχοι πάνω στα δεδομένα σας, ώστε να εντοπίζονται λάθη πριν γίνουν πρόβλημα
        στο ΦΠΑ ή στα οικονομικά των έργων.
      </p>

      {results.map((check) => (
        <div key={check.view} className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold">{check.title}</h2>
            <Badge tone={check.count === 0 ? "green" : "amber"}>{check.count}</Badge>
          </div>
          <p className="mb-2 text-xs text-ink-muted">{check.why}</p>
          {check.count > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(check.rows as any[]).map((r) => check.render(r as never))}
              {check.count > check.rows.length && (
                <p className="text-xs text-ink-faint">
                  … και {check.count - check.rows.length} ακόμα
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line py-1.5 first:border-t-0">
      {children}
    </div>
  );
}
