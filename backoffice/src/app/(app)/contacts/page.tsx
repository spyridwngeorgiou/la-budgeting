import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { PageHeader, buttonClass } from "@/components/ui";
import { ContactFormModal } from "./ContactFormModal";
import { ContactsTable } from "./ContactsTable";
import { createContact } from "./actions";

export default async function ContactsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data: rollup } = await supabase.from("v_contact_rollup").select("*").eq("org_id", orgId).order("name");

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.contacts}
        meta="Προμηθευτές, πελάτες και συνεργάτες, με σύνολο εσόδων/εξόδων και υπόλοιπο ανά επαφή."
        actions={
          <>
            <a href="/api/contacts/export" className={buttonClass("secondary", "md", "max-md:min-h-11")}>
              Εξαγωγή CSV
            </a>
            <ContactFormModal action={createContact} />
          </>
        }
      />

      <ContactsTable rollup={rollup ?? []} />
    </div>
  );
}
