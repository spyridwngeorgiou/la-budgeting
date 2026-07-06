export type ProjectStatus = "active" | "completed" | "on_hold";
export type AccountType = "bank" | "cash" | "gold" | "loan" | "other";
export type CategoryKind = "expense" | "income";
export type TxType = "expense" | "income";
export type TxStatus = "paid" | "upcoming" | "planned";
export type Recurrence = "monthly" | "oneoff";
export type ContactKind = "vendor" | "client" | "authority" | "professional" | "other";
export type VatStatus = "none" | "payable" | "paid" | "credit";

export interface Project {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  household_id: string;
  name: string;
  type: AccountType;
  balance: number;
  is_incoming: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  kind: CategoryKind;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  household_id: string;
  project_id: string | null;
  account_id: string | null;
  category_id: string | null;
  contact_id: string | null;
  type: TxType;
  amount: number;
  net_amount: number | null;
  vat_amount: number;
  withholding_amount: number;
  vat_status: VatStatus;
  status: TxStatus;
  tx_date: string;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  household_id: string;
  name: string;
  kind: ContactKind;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  household_id: string;
  project_id: string | null;
  name: string;
  monthly_rate: number;
  occupancy_pct: number;
  created_at: string;
  updated_at: string;
}

export interface ExpectedIncome {
  id: string;
  household_id: string;
  project_id: string | null;
  room_id: string | null;
  label: string;
  amount: number;
  recurrence: Recurrence;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Ενεργό",
  completed: "Ολοκληρωμένο",
  on_hold: "Σε αναμονή",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "Τράπεζα",
  cash: "Μετρητά",
  gold: "Χρυσός",
  loan: "Δάνειο",
  other: "Άλλο",
};

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  paid: "Πληρωμένο",
  upcoming: "Επερχόμενο",
  planned: "Σχεδιασμένο",
};

export const TX_TYPE_LABEL: Record<TxType, string> = {
  expense: "Έξοδο",
  income: "Έσοδο",
};

export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  vendor: "Προμηθευτής",
  client: "Πελάτης",
  authority: "Αρχή / Δημόσιο",
  professional: "Επαγγελματίας",
  other: "Άλλο",
};

export const VAT_STATUS_LABEL: Record<VatStatus, string> = {
  none: "Χωρίς ΦΠΑ",
  payable: "Οφειλόμενο",
  paid: "Πληρωμένο",
  credit: "Πιστωτικό",
};
