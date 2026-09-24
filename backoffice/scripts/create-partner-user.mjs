// One-off admin script: creates a Supabase Auth user and adds them to the
// existing org, working around the handle_new_user trigger (migration 0002)
// which auto-provisions a brand-new, empty org for every new auth.users row.
// Without the cleanup here, the new user would end up with TWO org_members
// rows, and getCurrentOrgId()'s unordered `.limit(1).single()` (src/lib/
// supabase/org.ts) could land them on the empty auto-created org instead of
// the real one.
//
// Usage: node --env-file=.env.local scripts/create-partner-user.mjs <email> <password>

import { createClient } from "@supabase/supabase-js";

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/create-partner-user.mjs <email> <password>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existingOrgs, error: orgsError } = await supabase.from("orgs").select("id, name");
  if (orgsError) throw orgsError;
  if (!existingOrgs || existingOrgs.length !== 1) {
    console.error(
      `Expected exactly 1 existing org, found ${existingOrgs?.length ?? 0}. Aborting -- resolve manually before running this script.`,
    );
    process.exit(1);
  }
  const realOrgId = existingOrgs[0].id;
  console.log(`Real org: ${existingOrgs[0].name} (${realOrgId})`);

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  const partnerId = created.user.id;
  console.log(`Created auth user ${email} (${partnerId})`);

  // The trigger already ran synchronously as part of the insert above --
  // find and remove the empty org it auto-provisioned for this user.
  const { data: autoMemberships, error: autoError } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", partnerId);
  if (autoError) throw autoError;

  for (const { org_id } of autoMemberships ?? []) {
    if (org_id === realOrgId) continue; // shouldn't happen yet, but never delete the real org
    const { error: deleteError } = await supabase.from("orgs").delete().eq("id", org_id);
    if (deleteError) throw deleteError;
    console.log(`Deleted auto-provisioned empty org ${org_id}`);
  }

  const { error: memberError } = await supabase
    .from("org_members")
    .upsert({ org_id: realOrgId, user_id: partnerId, role: "owner" }, { onConflict: "org_id,user_id" });
  if (memberError) throw memberError;
  console.log(`Added ${email} to ${existingOrgs[0].name} as owner`);

  const { data: finalMemberships, error: finalError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", partnerId);
  if (finalError) throw finalError;
  console.log("Final org_members rows for this user:", finalMemberships);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
