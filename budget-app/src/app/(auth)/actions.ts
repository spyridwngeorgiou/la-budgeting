"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Συμπλήρωσε email και κωδικό." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Λάθος στοιχεία ή ο λογαριασμός δεν υπάρχει." };
  }

  redirect("/dashboard");
}

export async function signUp(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || password.length < 6) {
    return { error: "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: "Αποτυχία εγγραφής: " + error.message };
  }

  // If email confirmation is disabled, a session is returned and we can go straight in.
  if (data.session) {
    redirect("/dashboard");
  }

  return {
    error: null,
    message: "Έλεγξε το email σου για επιβεβαίωση και μετά συνδέσου.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updatePassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 6) {
    return { error: "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες." };
  }
  if (password !== confirm) {
    return { error: "Οι κωδικοί δεν ταιριάζουν." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Αποτυχία αλλαγής κωδικού: " + error.message };
  }
  return { error: null, message: "Ο κωδικός άλλαξε επιτυχώς." };
}
