// ---------------------------------------------------------------------------
// Seed / import script for LA Budgeting.
//
// Reads `scripts/seed.json` and inserts projects, accounts, categories and
// transactions into Supabase for a given user's household.
//
// Usage:
//   1. Fill `.env.local` (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//   2. Copy scripts/seed.example.json -> scripts/seed.json and edit it
//   3. node scripts/import.mjs your@email.com
//
// The email must belong to an existing user (sign up first in the app).
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from .env.local
function loadEnv() {
  try {
    const txt = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] ??= m[2].trim();
    }
  } catch {
    // ignore
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];

if (!url || !serviceKey) {
  console.error("✗ Λείπουν NEXT_PUBLIC_SUPABASE_URL ή SUPABASE_SERVICE_ROLE_KEY στο .env.local");
  process.exit(1);
}
if (!email) {
  console.error("✗ Δώσε το email του χρήστη: node scripts/import.mjs your@email.com");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findHousehold(userEmail) {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = users.users.find((u) => u.email === userEmail);
  if (!user) throw new Error(`Δεν βρέθηκε χρήστης με email ${userEmail}. Κάνε πρώτα εγγραφή στην εφαρμογή.`);
  const { data: member } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("Ο χρήστης δεν έχει household.");
  return member.household_id;
}

async function main() {
  const seed = JSON.parse(readFileSync(join(__dirname, "seed.json"), "utf8"));
  const householdId = await findHousehold(email);
  console.log(`→ Household: ${householdId}`);

  // Projects
  const projectIdByName = {};
  for (const p of seed.projects ?? []) {
    const { data, error } = await supabase
      .from("projects")
      .insert({ household_id: householdId, name: p.name, description: p.description ?? null, status: p.status ?? "active" })
      .select("id")
      .single();
    if (error) throw error;
    projectIdByName[p.name] = data.id;
    console.log(`  ✓ Έργο: ${p.name}`);
  }

  // Accounts
  for (const a of seed.accounts ?? []) {
    const { error } = await supabase.from("accounts").insert({
      household_id: householdId,
      name: a.name,
      type: a.type ?? "bank",
      balance: a.balance ?? 0,
      is_incoming: a.is_incoming ?? false,
    });
    if (error) throw error;
    console.log(`  ✓ Λογαριασμός: ${a.name}`);
  }

  // Categories (skip if starter categories already cover it)
  const categoryIdByName = {};
  const { data: existingCats } = await supabase
    .from("categories")
    .select("id,name")
    .eq("household_id", householdId);
  for (const c of existingCats ?? []) categoryIdByName[c.name] = c.id;

  for (const c of seed.categories ?? []) {
    if (categoryIdByName[c.name]) continue;
    const { data, error } = await supabase
      .from("categories")
      .insert({ household_id: householdId, name: c.name, kind: c.kind ?? "expense" })
      .select("id")
      .single();
    if (error) throw error;
    categoryIdByName[c.name] = data.id;
    console.log(`  ✓ Κατηγορία: ${c.name}`);
  }

  // Transactions
  for (const t of seed.transactions ?? []) {
    const { error } = await supabase.from("transactions").insert({
      household_id: householdId,
      project_id: t.project ? projectIdByName[t.project] ?? null : null,
      category_id: t.category ? categoryIdByName[t.category] ?? null : null,
      type: t.type ?? "expense",
      amount: t.amount ?? 0,
      status: t.status ?? "upcoming",
      tx_date: t.date ?? new Date().toISOString().slice(0, 10),
      source: t.source ?? null,
      notes: t.notes ?? null,
    });
    if (error) throw error;
  }
  if (seed.transactions?.length) console.log(`  ✓ ${seed.transactions.length} κινήσεις`);

  console.log("✓ Ολοκληρώθηκε η εισαγωγή.");
}

main().catch((e) => {
  console.error("✗ Σφάλμα:", e.message);
  process.exit(1);
});
