import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, getCurrentMembership } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { Card, Badge } from "@/components/ui";
import { updateOwnAfm, updateOrgSettings } from "./actions";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { monthlyBudgetCents } from "@/lib/ai/client";
import { ORG_ROLE } from "@/lib/domain/enums";
import { updateMemberRole, removeMember, inviteMember } from "./team-actions";
import { CaptureAnalytics } from "./CaptureAnalytics";

const ROLE_LABELS: Record<string, string> = { viewer: "Θεατής", editor: "Συντάκτης", admin: "Διαχειριστής", owner: "Ιδιοκτήτης" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [org, membership] = await Promise.all([getCurrentOrg(supabase), getCurrentMembership(supabase)]);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const currentBudgetEuros = monthlyBudgetCents(settings.ai_monthly_budget_cents) / 100;
  const isAdmin = membership.role === "admin" || membership.role === "owner";

  // No direct FK between org_members and profiles (both reference
  // auth.users independently) -- PostgREST can't embed across that, so this
  // is two queries merged in JS, same as the /changes reviewer lookup.
  const { data: memberRows } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", membership.orgId)
    .order("role");
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const { data: memberProfiles } = memberIds.length
    ? await supabase.from("profiles").select("user_id, email, display_name").in("user_id", memberIds)
    : { data: [] };
  const profileFor = (userId: string) => memberProfiles?.find((p) => p.user_id === userId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{el.nav.settings}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Στοιχεία της επιχείρησης, όριο δαπάνης AI, κωδικός πρόσβασης, και εξαγωγή δεδομένων.
        </p>
      </div>

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Στοιχεία Επιχείρησης</h2>
        <form action={updateOwnAfm} className="flex flex-col gap-3">
          <Field>
            <Label>Επωνυμία</Label>
            <Input name="name" defaultValue={org?.name ?? ""} />
          </Field>
          <Field>
            <Label>ΑΦΜ Επιχείρησης</Label>
            <Input name="own_afm" defaultValue={org?.own_afm ?? ""} pattern="[0-9]{9}" maxLength={9} required />
          </Field>
          {org?.own_afm === "000000000" && (
            <p className="text-xs text-amber-ink">
              Προσοχή: εικονικό ΑΦΜ. Χρειάζεται το πραγματικό πριν από οποιαδήποτε εισαγωγή AADE,
              ώστε να καθορίζεται σωστά η κατεύθυνση (έσοδο/έξοδο) κάθε κίνησης.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit">{el.common.save}</Button>
          </div>
        </form>
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Ομάδα</h2>
        <div className="flex flex-col gap-2">
          {(memberRows ?? []).map((m) => {
            const profile = profileFor(m.user_id);
            return (
              <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 py-2 first:border-0 first:pt-0">
                <span className="text-sm">{profile?.display_name || profile?.email || m.user_id}</span>
                {isAdmin ? (
                  <div className="flex items-center gap-1.5">
                    <form action={updateMemberRole.bind(null, m.user_id)} className="flex items-center gap-1.5">
                      <Select name="role" defaultValue={m.role} className="!py-1 text-xs">
                        {ORG_ROLE.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                        Ενημέρωση
                      </Button>
                    </form>
                    <form action={removeMember.bind(null, m.user_id)}>
                      <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                        Αφαίρεση
                      </Button>
                    </form>
                  </div>
                ) : (
                  <Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <form action={inviteMember} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">Νέο Μέλος</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>Email</Label>
                <Input type="email" name="email" required />
              </Field>
              <Field>
                <Label>Κωδικός</Label>
                <Input type="text" name="password" minLength={8} required />
              </Field>
            </div>
            <Field>
              <Label>Ρόλος</Label>
              <Select name="role" defaultValue="editor">
                {ORG_ROLE.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end">
              <Button type="submit">Πρόσκληση</Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Όριο Δαπάνης AI</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Μηνιαίο όριο δαπάνης για όλες τις λειτουργίες AI (βοηθός, ανάγνωση παραστατικών, εκτιμήσεις
          εσόδων). Όταν εξαντληθεί, οι λειτουργίες AI μπλοκάρουν με σαφές μήνυμα μέχρι τον επόμενο μήνα.
        </p>
        <form action={updateOrgSettings} className="flex items-end gap-3">
          <Field>
            <Label>Όριο (€ / μήνα)</Label>
            <Input type="number" name="ai_monthly_budget_euros" step="1" min="1" defaultValue={currentBudgetEuros} required />
          </Field>
          <Button type="submit">{el.common.save}</Button>
        </form>
      </Card>

      {isAdmin && <CaptureAnalytics />}

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Αλλαγή Κωδικού</h2>
        <ChangePasswordForm />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Εξαγωγή Δεδομένων</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Οι κινήσεις σας δεν είναι κλειδωμένες σε αυτή την εφαρμογή -- κατεβάστε τις οποτεδήποτε σε
          CSV, ανοίγει σε Excel/Google Sheets.
        </p>
        <a href="/api/transactions/export">
          <Button variant="secondary">Εξαγωγή Κινήσεων (CSV)</Button>
        </a>
      </Card>
    </div>
  );
}
