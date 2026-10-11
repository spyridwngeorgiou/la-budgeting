import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, getCurrentMembership, getMyProfile } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { Badge, PageHeader, SectionHeader } from "@/components/ui";
import { setHomePath, updateOwnAfm, updateOrgSettings, updateTaxRiskSettings } from "./actions";
import { HOME_PATHS, resolveHomePath } from "@/lib/homePath";
import { Button, Input, Select, Label, Field, buttonClass } from "@/components/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { monthlyBudgetCents } from "@/lib/ai/client";
import { ORG_ROLE } from "@/lib/domain/enums";
import { updateMemberRole, removeMember, inviteMember } from "./team-actions";
import { CaptureAnalytics } from "./CaptureAnalytics";
import { ActionForm } from "@/components/ActionForm";

const ROLE_LABELS: Record<string, string> = { viewer: "Θεατής", editor: "Συντάκτης", admin: "Διαχειριστής", owner: "Ιδιοκτήτης" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [org, membership, profile] = await Promise.all([
    getCurrentOrg(supabase),
    getCurrentMembership(supabase),
    getMyProfile(supabase),
  ]);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const currentBudgetEuros = monthlyBudgetCents(settings.ai_monthly_budget_cents) / 100;
  const isAdmin = membership.role === "admin" || membership.role === "owner";

  // No direct FK between org_members and profiles (both reference
  // auth.users independently) -- PostgREST can't embed across that, so this
  // is two queries merged in JS, same as the pending-changes reviewer lookup.
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
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.settings}
        meta="Προσωπικά (αρχική σελίδα, κωδικός), στοιχεία της επιχείρησης, όριο δαπάνης AI και εξαγωγή δεδομένων."
      />

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Προσωπικά" />
        <ActionForm action={setHomePath} className="flex flex-wrap items-end gap-3">
          <Field>
            <Label>Αρχική σελίδα</Label>
            <Select name="home_path" defaultValue={resolveHomePath(profile?.home_path)}>
              {HOME_PATHS.map((h) => (
                <option key={h.path} value={h.path}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">{el.common.save}</Button>
        </ActionForm>
        <p className="text-small text-muted">Η σελίδα που ανοίγει μετά τη σύνδεση. Η «Επισκόπηση» μένει πάντα πρώτη στο μενού.</p>
        <div className="flex flex-col gap-3">
          <h3 className="eyebrow text-muted">Αλλαγή Κωδικού</h3>
          <ChangePasswordForm />
        </div>
      </section>

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Στοιχεία Επιχείρησης" />
        <ActionForm action={updateOwnAfm} className="flex flex-col gap-3">
          <Field>
            <Label>Επωνυμία</Label>
            <Input name="name" defaultValue={org?.name ?? ""} />
          </Field>
          <Field>
            <Label>ΑΦΜ Επιχείρησης</Label>
            <Input name="own_afm" defaultValue={org?.own_afm ?? ""} pattern="[0-9]{9}" maxLength={9} required />
          </Field>
          {org?.own_afm === "000000000" && (
            <p className="border-l-2 border-warning pl-3 text-small text-warning">
              Προσοχή: εικονικό ΑΦΜ. Χρειάζεται το πραγματικό πριν από οποιαδήποτε εισαγωγή AADE,
              ώστε να καθορίζεται σωστά η κατεύθυνση (έσοδο/έξοδο) κάθε κίνησης.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit">{el.common.save}</Button>
          </div>
        </ActionForm>
      </section>

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Ομάδα" />
        <div className="flex flex-col">
          {(memberRows ?? []).map((m) => {
            const profile = profileFor(m.user_id);
            return (
              <div key={m.user_id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-hairline py-2">
                <span className="min-w-0 text-body break-words text-ink">{profile?.display_name || profile?.email || m.user_id}</span>
                {isAdmin ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ActionForm action={updateMemberRole.bind(null, m.user_id)} className="flex items-center gap-1.5">
                      <Select name="role" defaultValue={m.role} className="!py-1 text-small">
                        {ORG_ROLE.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary" className="!px-2 !py-1 text-small">
                        Ενημέρωση
                      </Button>
                    </ActionForm>
                    <ActionForm action={removeMember.bind(null, m.user_id)}>
                      <Button type="submit" variant="danger" className="!px-2 !py-1 text-small">
                        Αφαίρεση
                      </Button>
                    </ActionForm>
                  </div>
                ) : (
                  <Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <ActionForm action={inviteMember} className="mt-2 flex flex-col gap-3">
            <h3 className="eyebrow text-muted">Νέο Μέλος</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </ActionForm>
        )}
      </section>

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Όριο Δαπάνης AI" />
        <p className="text-small text-muted">
          Μηνιαίο όριο δαπάνης για όλες τις λειτουργίες AI (βοηθός, ανάγνωση παραστατικών, εκτιμήσεις
          εσόδων). Όταν εξαντληθεί, οι λειτουργίες AI μπλοκάρουν με σαφές μήνυμα μέχρι τον επόμενο μήνα.
        </p>
        <ActionForm action={updateOrgSettings} className="flex flex-wrap items-end gap-3">
          <Field>
            <Label>Όριο (€ / μήνα)</Label>
            <Input type="number" name="ai_monthly_budget_euros" step="1" min="1" defaultValue={currentBudgetEuros} required />
          </Field>
          <Button type="submit">{el.common.save}</Button>
        </ActionForm>
      </section>

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Φορολογικός Κίνδυνος Παραστατικών" />
        <p className="text-small text-muted">
          Επιχειρηματικές δαπάνες πάνω από το όριο χωρίς παραστατικό (ή πληρωμένες με μετρητά) δεν
          εκπίπτουν. Χρησιμοποιείται από τον έλεγχο «Δαπάνες χωρίς παραστατικό» στους Ελέγχους Ποιότητας.
          Επιβεβαιώστε όριο και συντελεστή με τον λογιστή σας.
        </p>
        <ActionForm action={updateTaxRiskSettings} className="flex flex-wrap items-end gap-3">
          <Field>
            <Label>Όριο (€)</Label>
            <Input type="number" name="uninvoiced_threshold_eur" step="1" min="0" defaultValue={Number(settings.uninvoiced_threshold_eur ?? 500)} required />
          </Field>
          <Field>
            <Label>Φόρος εισοδήματος (%)</Label>
            <Input type="number" name="corporate_tax_rate_pct" step="0.1" min="0" max="100" defaultValue={Number(settings.corporate_tax_rate ?? 0.22) * 100} required />
          </Field>
          <Button type="submit">{el.common.save}</Button>
        </ActionForm>
      </section>

      {isAdmin && <CaptureAnalytics />}

      <section className="flex w-full max-w-md flex-col gap-4">
        <SectionHeader title="Εξαγωγή Δεδομένων" />
        <p className="text-small text-muted">
          Οι κινήσεις σας δεν είναι κλειδωμένες σε αυτή την εφαρμογή -- κατεβάστε τις οποτεδήποτε σε
          CSV, ανοίγει σε Excel/Google Sheets.
        </p>
        <div>
          <a href="/api/transactions/export" className={buttonClass("secondary")}>
            Εξαγωγή Κινήσεων (CSV)
          </a>
        </div>
      </section>
    </div>
  );
}
