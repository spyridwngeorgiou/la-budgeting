// Export OUR OWN database to a readable .xlsx (one sheet per subject), e.g. to
// hand to another assistant or to the accountant.
//
// Usage: node scripts/own-export.cjs <out.xlsx>

const ExcelJS = require("exceljs");
const { sql } = require("./own.cjs");

const SHEETS = [
  {
    name: "Κινήσεις",
    query: `select t.tx_date, t.paid_on, t.due_date,
      case t.status when 'paid' then 'Πληρωμένο' when 'pending' then 'Εκκρεμεί' when 'scheduled' then 'Προγραμματισμένο' else 'Ακυρωμένο' end as status,
      case t.direction when 'income' then 'Έσοδο' else 'Έξοδο' end as direction,
      p.display_name as project, c.name as category, a.name as account, coalesce(ct.name, t.counterparty_name) as contact, t.counterparty_afm,
      t.description, t.net_amount, t.vat_amount, t.withholding_amount, t.gross_amount,
      case when t.plan_id is not null then t.installment_no::text || '/' || coalesce(ip.installment_count::text, '?') end as instalment,
      case when t.scope = 'personal' then 'Προσωπικό' else 'Επιχείρηση' end as scope,
      t.invoice_number, t.notes, t.legacy_excel_id
      from transactions t
      left join projects p on p.id = t.project_id left join categories c on c.id = t.category_id
      left join accounts a on a.id = t.account_id left join contacts ct on ct.id = t.contact_id
      left join installment_plans ip on ip.id = t.plan_id
      order by t.tx_date, t.created_at`,
    columns: [
      ["Ημερομηνία", "tx_date", 12], ["Πληρώθηκε", "paid_on", 12], ["Λήξη", "due_date", 12], ["Κατάσταση", "status", 16],
      ["Τύπος", "direction", 8], ["Έργο", "project", 26], ["Κατηγορία", "category", 22], ["Λογαριασμός", "account", 20],
      ["Επαφή", "contact", 28], ["ΑΦΜ", "counterparty_afm", 11], ["Περιγραφή", "description", 50],
      ["Καθαρό", "net_amount", 12, true], ["ΦΠΑ", "vat_amount", 10, true], ["Παρακράτηση", "withholding_amount", 12, true],
      ["Πληρωτέο", "gross_amount", 12, true], ["Δόση", "instalment", 8], ["Πεδίο", "scope", 11],
      ["Αρ. Παραστατικού", "invoice_number", 18], ["Σημειώσεις", "notes", 50], ["Γραμμή Excel", "legacy_excel_id", 18],
    ],
  },
  {
    name: "Λογαριασμοί",
    query: `select name, case kind when 'cash' then 'Μετρητά' else 'Τράπεζα' end kind,
      case owner_scope when 'corporate' then 'Εταιρικός' else 'Προσωπικός' end owner, opening_balance, opening_balance_date, current_balance
      from v_account_balances order by owner_scope, name`,
    columns: [["Λογαριασμός", "name", 22], ["Είδος", "kind", 10], ["Κάτοχος", "owner", 12], ["Υπόλοιπο έναρξης", "opening_balance", 16, true], ["Ημ/νία έναρξης", "opening_balance_date", 14], ["Τρέχον υπόλοιπο", "current_balance", 16, true]],
  },
  {
    name: "Ρυθμίσεις & δόσεις",
    query: `select ip.label, p.display_name project, a.name account, ip.amount_per_installment + ip.vat_per_installment - ip.withholding_per_installment monthly,
      ip.installment_count, ip.first_due_date,
      (select count(*) from transactions t where t.plan_id = ip.id and t.status = 'paid') paid,
      (select count(*) from transactions t where t.plan_id = ip.id and t.status in ('pending','scheduled')) left_,
      (select min(coalesce(t.due_date, t.tx_date)) from transactions t where t.plan_id = ip.id and t.status in ('pending','scheduled')) next_due
      from installment_plans ip left join projects p on p.id = ip.project_id left join accounts a on a.id = ip.account_id order by ip.label`,
    columns: [["Ρύθμιση", "label", 50], ["Έργο", "project", 26], ["Λογαριασμός", "account", 20], ["Ποσό/μήνα", "monthly", 12, true], ["Δόσεις", "installment_count", 8], ["1η δόση", "first_due_date", 12], ["Πληρωμένες", "paid", 11], ["Απομένουν", "left_", 10], ["Επόμενη", "next_due", 12]],
  },
  {
    name: "Έργα",
    query: `select code, display_name, phase, opening_date from projects order by sort_order, code`,
    columns: [["Κωδικός", "code", 36], ["Όνομα", "display_name", 30], ["Φάση", "phase", 30], ["Άνοιγμα", "opening_date", 12]],
  },
  {
    name: "Επαφές",
    query: `select name, afm, kind, phone, email from contacts order by name`,
    columns: [["Επαφή", "name", 36], ["ΑΦΜ", "afm", 11], ["Τύπος", "kind", 10], ["Τηλέφωνο", "phone", 14], ["Email", "email", 28]],
  },
  {
    name: "Αναμενόμενα & δάνεια",
    query: `select 'Αναμενόμενο' kind, source who, amount, case certainty when 'certain' then 'Βέβαιο' else 'Πιθανό' end certainty, expected_month at, notes from expected_income
      union all select 'Δάνειο ιδιώτη', lender, principal, null, maturity_date, terms from liabilities
      union all select 'Δάνειο τράπεζας', l.label, l.principal, l.state::text, l.first_amortisation_month, l.notes from loans l
      union all select 'Εκταμίευση', l.label, d.amount, null, d.scheduled_month, null from loan_drawdowns d join loans l on l.id = d.loan_id
      union all select 'Περιουσία', name, estimated_value * ownership_pct, null, valuation_date, notes from assets
      order by 1, 5`,
    columns: [["Είδος", "kind", 18], ["Ποιος / τι", "who", 30], ["Ποσό", "amount", 14, true], ["Βεβαιότητα / κατάσταση", "certainty", 20], ["Μήνας / ημερομηνία", "at", 16], ["Σημειώσεις", "notes", 60]],
  },
];

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node scripts/own-export.cjs <out.xlsx>");
  const wb = new ExcelJS.Workbook();
  for (const s of SHEETS) {
    const rows = await sql(s.query);
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map(([header, key, width]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const row = {};
      for (const [, key, , money] of s.columns) row[key] = money && r[key] != null ? Number(r[key]) : r[key];
      ws.addRow(row);
    }
    s.columns.forEach(([, , , money], i) => { if (money) ws.getColumn(i + 1).numFmt = "#,##0.00"; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    console.log(`  ${s.name}: ${rows.length}`);
  }
  await wb.xlsx.writeFile(out);
  console.log(`Έγραψα ${out}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
