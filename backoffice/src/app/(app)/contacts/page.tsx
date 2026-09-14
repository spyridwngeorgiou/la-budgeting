import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { ContactFormModal } from "./ContactFormModal";
import { ContactsTable } from "./ContactsTable";
import { createContact } from "./actions";

export default async function ContactsPage() {
  const supabase = await createClient();
  const { data: rollup } = await supabase.from("v_contact_rollup").select("*").order("name");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{el.nav.contacts}</h1>
        <ContactFormModal action={createContact} />
      </div>

      <ContactsTable rollup={rollup ?? []} />
    </div>
  );
}
