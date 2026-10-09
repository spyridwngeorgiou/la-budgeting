"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/siteOrigin";

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // "/" rather than /dashboard: the proxy sends external partners on to
  // /collab from there.
  redirect("/");
}

// Password-less sign-in, mainly for external partners who were invited by
// email and never chose a password. shouldCreateUser:false -- this form
// must never become a public signup path (signup is what provisions orgs).
// The outcome is reported identically whether or not the address exists,
// so the form can't be used to probe who has an account.
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.includes("@")) {
    const supabase = await createClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
    });
  }
  redirect("/login?link=sent");
}
