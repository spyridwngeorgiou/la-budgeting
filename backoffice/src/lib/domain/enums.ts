// TypeScript mirror of the Postgres enums in
// supabase/migrations/0001_extensions_and_enums.sql, and of the Greek-literal
// -> enum map in tools/mappings.py. Keep all three in lockstep by hand; there
// are few enough values that a code generator would cost more than it saves.

export const TX_DIRECTION = ["income", "expense"] as const;
export type TxDirection = (typeof TX_DIRECTION)[number];

export const TX_SCOPE = ["business", "personal"] as const;
export type TxScope = (typeof TX_SCOPE)[number];

export const TX_STATUS = ["paid", "pending", "scheduled", "cancelled"] as const;
export type TxStatus = (typeof TX_STATUS)[number];

export const TX_ORIGIN = ["aade", "manual", "bank_file", "ai_document", "ai_nl"] as const;
export type TxOrigin = (typeof TX_ORIGIN)[number];

export const ACCOUNT_KIND = ["bank", "cash", "gold", "crypto", "other"] as const;
export type AccountKind = (typeof ACCOUNT_KIND)[number];

export const OWNER_SCOPE = ["corporate", "personal"] as const;
export type OwnerScope = (typeof OWNER_SCOPE)[number];

export const PROJECT_TYPE = [
  "construction",
  "installation",
  "renovation",
  "hospitality",
  "general",
] as const;
export type ProjectType = (typeof PROJECT_TYPE)[number];

export const PROJECT_STATUS = ["offer", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const BUSINESS_MODEL = [
  "own_development",
  "client_project",
  "hotel_lease",
  "general",
] as const;
export type BusinessModel = (typeof BUSINESS_MODEL)[number];

export const PLAN_FREQUENCY = ["monthly", "quarterly", "semiannual", "annual"] as const;
export type PlanFrequency = (typeof PLAN_FREQUENCY)[number];

export const PLAN_STATUS = ["active", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

export const FILING_STATUS = ["pending", "filed", "paid", "cancelled"] as const;
export type FilingStatus = (typeof FILING_STATUS)[number];

export const BUDGET_LINE_CODE = [
  "acquisition",
  "studies_permits_legal",
  "construction_equipment",
  "other",
] as const;
export type BudgetLineCode = (typeof BUDGET_LINE_CODE)[number];

export const CERTAINTY = ["certain", "probable"] as const;
export type Certainty = (typeof CERTAINTY)[number];

export const LIABILITY_KIND = ["private", "bank"] as const;
export type LiabilityKind = (typeof LIABILITY_KIND)[number];

export const LIABILITY_STATE = ["in_application", "approved", "disbursed", "repaid"] as const;
export type LiabilityState = (typeof LIABILITY_STATE)[number];

export const ASSET_STATE = ["held", "pending_inheritance"] as const;
export type AssetState = (typeof ASSET_STATE)[number];

export const ORG_ROLE = ["viewer", "editor", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLE)[number];

export const VAT_RATES = [0, 0.06, 0.13, 0.24] as const;
export type VatRate = (typeof VAT_RATES)[number];

// Greek literal -> enum, as read out of Επιχειρησιακό_Αρχείο_107.xlsx.
// Mirrors tools/mappings.py exactly; the migration script fails loudly on
// any literal not present here rather than silently defaulting.
export const DIRECTION_FROM_GREEK: Record<string, TxDirection> = {
  Έσοδο: "income",
  Έξοδο: "expense",
};

export const STATUS_FROM_GREEK: Record<string, TxStatus> = {
  Πληρωμένο: "paid",
  Εκκρεμεί: "pending",
  Προγραμματισμένο: "scheduled",
  "Σε αναμονή": "pending",
  Ακυρώθηκε: "cancelled",
};

export const SCOPE_FROM_GREEK: Record<string, TxScope> = {
  Επιχειρηματικό: "business",
  Προσωπικό: "personal",
};

export const ORIGIN_FROM_GREEK: Record<string, TxOrigin> = {
  AADE: "aade",
  Χειρόγραφο: "manual",
  "Τραπεζικό αρχείο": "bank_file",
};

export const OWNER_SCOPE_FROM_GREEK: Record<string, OwnerScope> = {
  Εταιρικός: "corporate",
  Προσωπικός: "personal",
};
