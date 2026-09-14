import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { Card } from "@/components/ui";
import { updateOwnAfm } from "./actions";
import { Button, Input, Label, Field } from "@/components/ui";

export default async function SettingsPage() {
  const supabase = await createClient();
  const org = await getCurrentOrg(supabase);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{el.nav.settings}</h1>

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
            <p className="text-xs text-amber-700">
              Προσοχή: εικονικό ΑΦΜ. Χρειάζεται το πραγματικό πριν από οποιαδήποτε εισαγωγή AADE,
              ώστε να καθορίζεται σωστά η κατεύθυνση (έσοδο/έξοδο) κάθε κίνησης.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit">{el.common.save}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
