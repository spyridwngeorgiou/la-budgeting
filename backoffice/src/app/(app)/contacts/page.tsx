import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { PageHeader, buttonClass } from "@/components/ui";
import { ContactFormButton } from "./ContactForm";
import { ContactsTable } from "./ContactsTable";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  // The rollup has the sums; phone and email (for «Επεξεργασία») come from
  // the contacts themselves, in parallel.
  const [{ data: rollup }, { data: details }] = await Promise.all([
    supabase.from("v_contact_rollup").select("*").eq("org_id", orgId).order("name"),
    supabase.from("contacts").select("id, phone, email").eq("org_id", orgId),
  ]);
  const byId = new Map((details ?? []).map((d) => [d.id, d]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.contacts}
        meta="Προμηθευτές, πελάτες και συνεργάτες, με σύνολο εσόδων/εξόδων και υπόλοιπο ανά επαφή."
        actions={
          <>
            <a href="/api/contacts/export" className={buttonClass("secondary", "md")}>
              Εξαγωγή CSV
            </a>
            <ContactFormButton label={el.contact.add} />
          </>
        }
      />

      <ContactsTable
        initialQuery={(Array.isArray(q) ? q[0] : q) ?? ""}
        rollup={(rollup ?? []).map((r) => {
          const d = r.contact_id ? byId.get(r.contact_id) : undefined;
          return {
            contact_id: r.contact_id,
            name: r.name,
            afm: r.afm,
            phone: d?.phone ?? null,
            email: d?.email ?? null,
            total_income: r.total_income,
            total_expense: r.total_expense,
            outstanding: r.outstanding,
            net_balance: r.net_balance,
          };
        })}
      />
    </div>
  );
}
