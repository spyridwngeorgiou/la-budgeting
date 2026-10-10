import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { Badge, ButtonLink, Field, Input, Label, SectionHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PARTNER_DISCIPLINE, PROJECT_ROLE } from "@/lib/domain/enums";
import {
  invitePartner,
  updatePartnerRole,
  removePartner,
  resendPartnerAccess,
  resendPartnerInvite,
  cancelPartnerInvite,
} from "./partner-actions";
import { ActionForm } from "@/components/ActionForm";

// Server component, rendered per request -- "now" is the request time.
function isExpired(iso: string) {
  return new Date(iso).getTime() < Date.now();
}

// One person / invite: name and facts on the left, the admin's controls on
// the right (under it on phones), a hairline between rows.
const ROW = "flex flex-col gap-2 border-b border-hairline py-3 md:flex-row md:items-center md:justify-between md:gap-6";
const ACTION = "max-md:min-h-11";

// «Συνεργάτες έργου» on the project page. Everyone internal sees who has
// access; only admins/owners can invite, change roles or remove (the
// actions re-check, and RLS on project_members/project_invites enforces it
// regardless).
export async function PartnersPanel({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const supabase = await createClient();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("project_members")
      .select("user_id, role, discipline, created_at")
      .eq("project_id", projectId)
      .order("created_at"),
    // RLS returns nothing here for non-admins, which is what we want.
    supabase
      .from("project_invites")
      .select("id, email, full_name, role, expires_at")
      .eq("project_id", projectId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at"),
  ]);

  // No FK between project_members and profiles (both reference auth.users),
  // so profiles come in a second query -- same as the settings team list.
  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("user_id, email, display_name, company_name").in("user_id", memberIds)
    : { data: [] };
  const profileFor = (userId: string) => profiles?.find((p) => p.user_id === userId);

  // "Has this partner ever actually signed in?" lives in auth.users, which
  // only the Admin API reads. Admins only, and only for this project's few
  // members.
  const neverSignedIn = new Set<string>();
  if (isAdmin && memberIds.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceRoleClient();
    const users = await Promise.all(memberIds.map((id) => admin.auth.admin.getUserById(id)));
    users.forEach(({ data }, i) => {
      if (data.user && !data.user.last_sign_in_at) neverSignedIn.add(memberIds[i]);
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title={el.partner.panelTitle}
        actions={
          <ButtonLink href={`/collab/${projectId}`} variant="secondary" size="sm" className={ACTION}>
            {el.collab.navLabel} →
          </ButtonLink>
        }
      />
      <p className="max-w-prose text-small text-muted">{el.partner.panelHint}</p>

      {(members ?? []).length === 0 && (invites ?? []).length === 0 && (
        <p className="border-b border-hairline pb-3 text-sm text-muted">{el.partner.none}</p>
      )}

      <ul className="flex flex-col">
        {(members ?? []).map((m) => {
          const profile = profileFor(m.user_id);
          return (
            <li key={m.user_id} className={ROW}>
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {profile?.display_name || profile?.email || el.collab.unknownUser}
                  {profile?.company_name && <span className="text-muted"> · {profile.company_name}</span>}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-small text-muted">
                  {profile?.display_name && profile.email && <span className="truncate">{profile.email}</span>}
                  {m.discipline && <Badge>{el.partner.disciplineValues[m.discipline]}</Badge>}
                  {!isAdmin && <Badge tone="positive">{el.partner.roleValues[m.role]}</Badge>}
                  {neverSignedIn.has(m.user_id) && <Badge tone="warning">{el.partner.pending}</Badge>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm
                    action={updatePartnerRole.bind(null, projectId, m.user_id)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Select name="role" defaultValue={m.role} className={ACTION} aria-label={el.partner.role}>
                      {PROJECT_ROLE.map((r) => (
                        <option key={r} value={r}>
                          {el.partner.roleValues[r]}
                        </option>
                      ))}
                    </Select>
                    <input type="hidden" name="discipline" value={m.discipline ?? ""} />
                    <SubmitButton variant="secondary" className={ACTION}>
                      {el.partner.update}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={resendPartnerAccess.bind(null, projectId, m.user_id)}>
                    <SubmitButton variant="ghost" className={ACTION}>
                      {el.partner.resend}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={removePartner.bind(null, projectId, m.user_id)}>
                    <SubmitButton variant="danger" className={ACTION}>
                      {el.partner.remove}
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
            </li>
          );
        })}

        {(invites ?? []).map((inv) => {
          const expired = isExpired(inv.expires_at);
          return (
            <li key={inv.id} className={ROW}>
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{inv.full_name || inv.email}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-small text-muted">
                  {inv.full_name && <span className="truncate">{inv.email}</span>}
                  <Badge>{el.partner.roleValues[inv.role]}</Badge>
                  <Badge tone={expired ? "negative" : "warning"}>
                    {expired ? el.partner.expired : `${el.partner.pending} · ${formatDate(inv.expires_at.slice(0, 10))}`}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={resendPartnerInvite.bind(null, projectId, inv.id)}>
                  <SubmitButton variant="ghost" className={ACTION}>
                    {el.partner.resend}
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={cancelPartnerInvite.bind(null, projectId, inv.id)}>
                  <SubmitButton variant="danger" className={ACTION}>
                    {el.partner.cancelInvite}
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <ActionForm action={invitePartner.bind(null, projectId)} className="mt-6 flex flex-col gap-4">
          <h3 className="eyebrow border-b border-hairline pb-2 text-muted">{el.partner.inviteTitle}</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <Field>
              <Label htmlFor="partner-invite-full-name">{el.partner.fullName}</Label>
              <Input id="partner-invite-full-name" name="full_name" autoComplete="off" />
            </Field>
            <Field>
              <Label htmlFor="partner-invite-company">{el.partner.company}</Label>
              <Input id="partner-invite-company" name="company_name" autoComplete="off" />
            </Field>
            <Field>
              <Label htmlFor="partner-invite-email">{el.partner.email}</Label>
              <Input id="partner-invite-email" type="email" name="email" required autoComplete="off" />
            </Field>
            <Field>
              <Label htmlFor="partner-invite-discipline">{el.partner.discipline}</Label>
              <Select id="partner-invite-discipline" name="discipline" defaultValue="">
                <option value="">—</option>
                {PARTNER_DISCIPLINE.map((d) => (
                  <option key={d} value={d}>
                    {el.partner.disciplineValues[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label
                htmlFor="partner-invite-role"
                title={PROJECT_ROLE.map((r) => `${el.partner.roleValues[r]}: ${el.partner.roleHints[r]}`).join("\n")}
              >
                {el.partner.role}
              </Label>
              <Select id="partner-invite-role" name="role" defaultValue="contributor">
                {PROJECT_ROLE.map((r) => (
                  <option key={r} value={r}>
                    {el.partner.roleValues[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton className={ACTION}>{el.partner.invite}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}
