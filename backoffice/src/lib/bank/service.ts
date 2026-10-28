// Server-only helpers shared by /bank, its callback and the scheduled sync.
import { createClient } from "@supabase/supabase-js";

// The feed starts the day after the last bank statements that were checked
// line by line (Optima and Πειραιώς, 12/10/2026): everything before is in
// the ledger already.
export const BANK_FEED_START = "2026-10-13";

export const APP_URL = "https://kansha-backoffice.kansha-chris.workers.dev";

// Banks offered on /bank, and the ledger account each one feeds by default.
export const BANKS = [
  { aspsp: "Optima bank", psuType: "business" as const, label: "Optima — εταιρικός", account: "Optima Εταιρικός" },
  { aspsp: "Piraeus Bank", psuType: "personal" as const, label: "Πειραιώς — προσωπικός", account: "Πειραιώς Προσωπικός" },
  { aspsp: "Optima bank", psuType: "personal" as const, label: "Optima — προσωπικός", account: "Optima Προσωπικός" },
  { aspsp: "Alpha Bank", psuType: "personal" as const, label: "Alpha — προσωπικός", account: "Alpha Προσωπικός" },
  { aspsp: "N26", psuType: "personal" as const, label: "N26 — προσωπικός", account: "N26 Προσωπικός" },
];

// Service-role client: the bank feed writes run tables that users only read.
export function serviceClient(actor = "bank-feed") {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Λείπουν ρυθμίσεις του server.");
  return createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-actor-email": actor } } });
}
