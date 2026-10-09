import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Label, Select } from "@/components/ui";
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

// Server component, rendered per request -- "now" is the request time.
function isExpired(iso: string) {
  return new Date(iso).getTime() < Date.now();
}

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
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-muted">{el.partner.panelTitle}</h2>
        <Link href={`/collab/${projectId}`}>
          <Button variant="secondary" className="!px-2 !py-1 text-xs">
            {el.collab.navLabel} →
          </Button>
        </Link>
      </div>
      <p className="mb-3 text-xs text-ink-muted">{el.partner.panelHint}</p>

      {(members ?? []).length === 0 && (invites ?? []).length === 0 && (
        <p className="py-2 text-sm text-ink-faint">{el.partner.none}</p>
      )}

      <div className="flex flex-col">
        {(members ?? []).map((m) => {
          const profile = profileFor(m.user_id);
          return (
            <div
              key={m.user_id}
              className="flex flex-col gap-2 border-t border-line/60 py-2 first:border-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {profile?.display_name || profile?.email || el.collab.unknownUser}
                  {profile?.company_name && <span className="text-ink-muted"> · {profile.company_name}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  {profile?.display_name && profile.email && <span className="truncate">{profile.email}</span>}
                  {m.discipline && <Badge>{el.partner.disciplineValues[m.discipline]}</Badge>}
                  {!isAdmin && <Badge tone="green">{el.partner.roleValues[m.role]}</Badge>}
                  {neverSignedIn.has(m.user_id) && <Badge tone="amber">{el.partner.pending}</Badge>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <form
                    action={updatePartnerRole.bind(null, projectId, m.user_id)}
                    className="flex items-center gap-1.5"
                  >
                    <Select name="role" defaultValue={m.role} className="!py-1 text-xs" aria-label={el.partner.role}>
                      {PROJECT_ROLE.map((r) => (
                        <option key={r} value={r}>
                          {el.partner.roleValues[r]}
                        </option>
                      ))}
                    </Select>
                    <input type="hidden" name="discipline" value={m.discipline ?? ""} />
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                      {el.partner.update}
                    </SubmitButton>
                  </form>
                  <form action={resendPartnerAccess.bind(null, projectId, m.user_id)}>
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                      {el.partner.resend}
                    </SubmitButton>
                  </form>
                  <form action={removePartner.bind(null, projectId, m.user_id)}>
                    <SubmitButton variant="danger" className="!px-2 !py-1 text-xs">
                      {el.partner.remove}
                    </SubmitButton>
                  </form>
                </div>
              )}
            </div>
          );
        })}

        {(invites ?? []).map((inv) => {
          const expired = isExpired(inv.expires_at);
          return (
            <div
              key={inv.id}
              className="flex flex-col gap-2 border-t border-line/60 py-2 first:border-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{inv.full_name || inv.email}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  {inv.full_name && <span className="truncate">{inv.email}</span>}
                  <Badge>{el.partner.roleValues[inv.role]}</Badge>
                  <Badge tone={expired ? "red" : "amber"}>
                    {expired ? el.partner.expired : `${el.partner.pending} · ${formatDate(inv.expires_at.slice(0, 10))}`}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <form action={resendPartnerInvite.bind(null, projectId, inv.id)}>
                  <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                    {el.partner.resend}
                  </SubmitButton>
                </form>
                <form action={cancelPartnerInvite.bind(null, projectId, inv.id)}>
                  <SubmitButton variant="danger" className="!px-2 !py-1 text-xs">
                    {el.partner.cancelInvite}
                  </SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <form
          action={invitePartner.bind(null, projectId)}
          className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
        >
          <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">{el.partner.inviteTitle}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <Label>{el.partner.fullName}</Label>
              <Input name="full_name" autoComplete="off" />
            </Field>
            <Field>
              <Label>{el.partner.company}</Label>
              <Input name="company_name" autoComplete="off" />
            </Field>
            <Field>
              <Label>{el.partner.email}</Label>
              <Input type="email" name="email" required autoComplete="off" />
            </Field>
            <Field>
              <Label>{el.partner.discipline}</Label>
              <Select name="discipline" defaultValue="">
                <option value="">—</option>
                {PARTNER_DISCIPLINE.map((d) => (
                  <option key={d} value={d}>
                    {el.partner.disciplineValues[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label title={PROJECT_ROLE.map((r) => `${el.partner.roleValues[r]}: ${el.partner.roleHints[r]}`).join("\n")}>
                {el.partner.role}
              </Label>
              <Select name="role" defaultValue="contributor">
                {PROJECT_ROLE.map((r) => (
                  <option key={r} value={r}>
                    {el.partner.roleValues[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>{el.partner.invite}</SubmitButton>
          </div>
        </form>
      )}
    </Card>
  );
}
