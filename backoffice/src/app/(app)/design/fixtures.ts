// Made-up data for the /design gallery. Not real records -- shaped like the
// app's own so every component is seen with realistic lengths and signs.

export interface DemoTx {
  id: string;
  date: string;
  description: string;
  contact: string;
  project: string;
  amount: number;
  status: "paid" | "pending" | "scheduled";
}

export const DEMO_TX: DemoTx[] = [
  { id: "1", date: "02/10/2026", description: "Ενοίκιο Οκτωβρίου — Q004", contact: "Παπαδόπουλος Α.", project: "Q004 Ηλιούπολη", amount: 1250, status: "paid" },
  { id: "2", date: "03/10/2026", description: "ΔΕΗ λογαριασμός ρεύματος", contact: "ΔΕΗ Α.Ε.", project: "Q004 Ηλιούπολη", amount: -184.6, status: "paid" },
  { id: "3", date: "05/10/2026", description: "Τιμολόγιο αρχιτέκτονα, 2η δόση μελέτης εφαρμογής", contact: "Studio Λ. Αλεξίου", project: "P15 Residences", amount: -3200, status: "pending" },
  { id: "4", date: "12/10/2026", description: "Προκαταβολή αγοραστή διαμερίσματος Β2", contact: "Γεωργίου Μ.", project: "P15 Residences", amount: 12400, status: "scheduled" },
  { id: "5", date: "15/10/2026", description: "ΕΦΚΑ εισφορές Σεπτεμβρίου", contact: "e-ΕΦΚΑ", project: "—", amount: -642.18, status: "scheduled" },
];

export const DEMO_STATUS_TONE = { paid: "positive", pending: "warning", scheduled: "neutral" } as const;
export const DEMO_STATUS_LABEL = { paid: "Πληρωμένη", pending: "Εκκρεμεί", scheduled: "Προγραμματισμένη" } as const;

export const DEMO_CASH = [
  { month: "Νοε", cash: 84200, plan: 80000 },
  { month: "Δεκ", cash: 79100, plan: 78000 },
  { month: "Ιαν", cash: 71800, plan: 76000 },
  { month: "Φεβ", cash: 66300, plan: 72000 },
  { month: "Μαρ", cash: 92500, plan: 70000 },
  { month: "Απρ", cash: 88900, plan: 74000 },
  { month: "Μαϊ", cash: 81200, plan: 76000 },
  { month: "Ιουν", cash: 64700, plan: 73000 },
  { month: "Ιουλ", cash: 52100, plan: 70000 },
  { month: "Αυγ", cash: 47900, plan: 66000 },
  { month: "Σεπ", cash: 58600, plan: 64000 },
  { month: "Οκτ", cash: 61300, plan: 62000 },
];

export const DEMO_WORKLIST = [
  { severity: "urgent", title: "3 ληξιπρόθεσμες πληρωμές", meta: "Η παλαιότερη από 21/09/2026", count: 3, amount: "−4.026,78 €", href: "/transactions" },
  { severity: "attention", title: "Κινήσεις χωρίς κατηγορία", meta: "Τελευταίες 30 ημέρες", count: 12, href: "/reports/quality" },
  { severity: "info", title: "Νέο αρχείο τράπεζας προς έλεγχο", meta: "Eurobank · Σεπτέμβριος", count: 48, href: "/inbox" },
] as const;

export const DEMO_KEY_VALUE = [
  { label: "Πελάτης", value: "Γεωργίου Μ." },
  { label: "Τίμημα", value: "248.000,00 €", numeric: true },
  { label: "Προκαταβολή", value: "+12.400,00 €", numeric: true },
  { label: "Υπογραφή", value: "12/10/2026" },
];
