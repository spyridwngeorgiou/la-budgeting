"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseholdId } from "@/lib/household";

export async function inviteCollaborator(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { error: "Δώσε έγκυρο email." };
  }

  const householdId = await getHouseholdId();
  if (!householdId) return { error: "Δεν βρέθηκε νοικοκυριό." };

  const admin = createAdminClient();

  // Find existing user by email (paginate a bit)
  let userId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list?.users.find((u) => u.email?.toLowerCase() === email);
  let tempPassword: string | null = null;

  if (found) {
    userId = found.id;
  } else {
    tempPassword = "LA-" + randomBytes(6).toString("base64url");
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (error || !created?.user) {
      return { error: "Αποτυχία δημιουργίας χρήστη: " + (error?.message ?? "") };
    }
    userId = created.user.id;

    // The signup trigger auto-creates a personal household for the new user.
    // Remove it so they belong only to the shared household.
    const { data: ownHouseholds } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .eq("role", "owner");
    for (const h of ownHouseholds ?? []) {
      await admin.from("households").delete().eq("id", h.household_id);
    }
  }

  // Add to the household (idempotent)
  const { error: memErr } = await admin
    .from("household_members")
    .upsert(
      { household_id: householdId, user_id: userId, role: "editor" },
      { onConflict: "household_id,user_id" },
    );
  if (memErr) {
    return { error: "Αποτυχία προσθήκης στο νοικοκυριό: " + memErr.message };
  }

  revalidatePath("/settings");
  return {
    error: null,
    message: tempPassword
      ? `Ο συνεργάτης προστέθηκε. Προσωρινός κωδικός (δώσ' τον με ασφάλεια, θα τον αλλάξει): ${tempPassword}`
      : "Ο υπάρχων χρήστης προστέθηκε στο κοινό budget.",
  };
}

export async function removeCollaborator(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return;

  const householdId = await getHouseholdId();
  if (!householdId) return;

  // Prevent removing yourself (the owner)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) return;

  const admin = createAdminClient();
  await admin
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId);

  revalidatePath("/settings");
}
