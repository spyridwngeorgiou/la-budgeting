"use server";

import { revalidateProject } from "../revalidate";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { formString } from "@/lib/supabase/org";
import { requireOrgAdmin, createServiceRoleClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/siteOrigin";
import { el } from "@/lib/i18n/el";
import {
  PARTNER_DISCIPLINE,
  PROJECT_ROLE,
  type PartnerDiscipline,
  type ProjectRole,
} from "@/lib/domain/enums";
import { action, UserError, type ActionResult } from "@/lib/actions";

// External partners are invited per project and live only in
// project_members (0037) -- never org_members. Every action re-derives the
// org from the caller's own admin membership and re-checks that the project
// belongs to it; the projectId bound from the page is never trusted alone.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireProjectAdmin(supabase: ServerClient, projectId: string) {
  const orgId = await requireOrgAdmin(supabase, el.partner.errors.adminOnly);
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!project) throw new UserError(el.partner.errors.projectNotFound);
  return orgId;
}

function parseRole(formData: FormData): ProjectRole {
  const role = formString(formData, "role");
  return PROJECT_ROLE.find((r) => r === role) ?? "contributor";
}

function parseDiscipline(formData: FormData): PartnerDiscipline | null {
  const d = formString(formData, "discipline");
  return PARTNER_DISCIPLINE.find((x) => x === d) ?? null;
}

// The `ilike` below is the only lookup by email, so LIKE wildcards in an
// address (`_` is legal) must not match other accounts.
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// A sign-in link for an existing account, sent from a throwaway anon
// client: the admin's own cookie-bound client would otherwise write a PKCE
// verifier for *someone else's* login into the admin's browser.
async function sendSignInLink(email: string) {
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });
  const { error } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
  });
  if (error) throw error;
}

// Grants `email` access to the project: directly if the login already
// exists, otherwise by a pending invite that handle_new_user consumes the
// moment inviteUserByEmail creates the auth user.
async function grantOrInvite(
  supabase: ServerClient,
  orgId: string,
  projectId: string,
  invite: {
    email: string;
    role: ProjectRole;
    discipline: PartnerDiscipline | null;
    fullName: string | null;
    companyName: string | null;
  },
) {
  // Service role only for what RLS rightly hides from an admin: whether a
  // login with this address exists anywhere, and the Auth Admin API.
  const admin = createServiceRoleClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { data: existing } = await admin
    .from("profiles")
    .select("user_id")
    .ilike("email", escapeLike(invite.email))
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data: internal } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", existing.user_id)
      .maybeSingle();
    if (internal) throw new UserError(el.partner.errors.isInternal);

    // RLS-scoped write: project_members_write requires admin of this org.
    const { error } = await supabase.from("project_members").upsert(
      {
        project_id: projectId,
        user_id: existing.user_id,
        org_id: orgId,
        role: invite.role,
        discipline: invite.discipline,
        invited_by: session?.user.id ?? null,
      },
      { onConflict: "project_id,user_id" },
    );
    if (error) throw error;
    await sendSignInLink(invite.email);
    return;
  }

  // One live invite per (project, email): supersede rather than stack.
  await supabase
    .from("project_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("email", invite.email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { error: inviteError } = await supabase.from("project_invites").insert({
    project_id: projectId,
    org_id: orgId,
    email: invite.email,
    full_name: invite.fullName,
    company_name: invite.companyName,
    role: invite.role,
    discipline: invite.discipline,
  });
  if (inviteError) throw inviteError;

  const { error: authError } = await admin.auth.admin.inviteUserByEmail(invite.email, {
    redirectTo: `${await siteOrigin()}/auth/confirm`,
  });
  // The invite row stays pending on failure (e.g. SMTP down) and can be
  // re-sent from the panel.
  if (authError) throw authError;
}

export async function invitePartner(projectId: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await requireProjectAdmin(supabase, projectId);

    const email = (formString(formData, "email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError(el.partner.errors.invalidEmail);

    await grantOrInvite(supabase, orgId, projectId, {
      email,
      role: parseRole(formData),
      discipline: parseDiscipline(formData),
      fullName: formString(formData, "full_name")?.trim() || null,
      companyName: formString(formData, "company_name")?.trim() || null,
    });
    revalidateProject(projectId);
  });
}

export async function updatePartnerRole(projectId: string, userId: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    await requireProjectAdmin(supabase, projectId);

    const { error } = await supabase
      .from("project_members")
      .update({ role: parseRole(formData), discipline: parseDiscipline(formData) })
      .eq("project_id", projectId)
      .eq("user_id", userId);
    if (error) throw error;
    revalidateProject(projectId);
  });
}

// Removes access to this project only. The auth user stays (they may
// partner on other projects); with no memberships left they simply land on
// an empty /collab.
export async function removePartner(projectId: string, userId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    await requireProjectAdmin(supabase, projectId);

    const { error } = await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
    if (error) throw error;
    revalidateProject(projectId);
  });
}

// New sign-in link for an existing partner (lost the email, link expired).
export async function resendPartnerAccess(projectId: string, userId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    await requireProjectAdmin(supabase, projectId);

    const { data: member } = await supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) throw new UserError(el.partner.errors.inviteNotFound);
    const { data: profile } = await supabase.from("profiles").select("email").eq("user_id", userId).maybeSingle();
    if (!profile?.email) throw new UserError(el.partner.errors.invalidEmail);

    await sendSignInLink(profile.email);
  });
}

// Retry a still-pending invite (its email never went out, or it expired).
export async function resendPartnerInvite(projectId: string, inviteId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await requireProjectAdmin(supabase, projectId);

    const { data: invite } = await supabase
      .from("project_invites")
      .select("email, role, discipline, full_name, company_name")
      .eq("id", inviteId)
      .eq("project_id", projectId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle();
    if (!invite) throw new UserError(el.partner.errors.inviteNotFound);

    await grantOrInvite(supabase, orgId, projectId, {
      email: invite.email,
      role: invite.role,
      discipline: invite.discipline,
      fullName: invite.full_name,
      companyName: invite.company_name,
    });
    revalidateProject(projectId);
  });
}

export async function cancelPartnerInvite(projectId: string, inviteId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    await requireProjectAdmin(supabase, projectId);

    const { error } = await supabase
      .from("project_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .eq("project_id", projectId);
    if (error) throw error;
    revalidateProject(projectId);
  });
}
