import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { Button } from "@/components/ui";
import { ContactFormModal } from "./ContactFormModal";
import { ContactsTable } from "./ContactsTable";
import { createContact } from "./actions";

export default async function ContactsPage() {
  const supabase = await createClient();
  const { data: rollup } = await supabase.from("v_contact_rollup").select("*").order("name");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.contacts}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Προμηθευτές, πελάτες και συνεργάτες, με σύνολο εσόδων/εξόδων και υπόλοιπο ανά επαφή.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/contacts/export">
            <Button variant="secondary">Εξαγωγή CSV</Button>
          </a>
          <ContactFormModal action={createContact} />
        </div>
      </div>

      <ContactsTable rollup={rollup ?? []} />
    </div>
  );
}
