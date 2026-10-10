import Form from "next/form";
import { Amount, ButtonLink, DataTable, Input, MenuLink, Toolbar, type Column } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";
import { searchTerm, type Params } from "./filters";
import { one, requireInternal } from "./data";
import { saveContact } from "./actions";
import { UrlDrawer } from "./client";
import { ContactFields } from "./fields";

// «Επαφές»: v_contact_rollup (totals and balance per contact), searchable
// by name or ΑΦΜ (?q=). New / edit in a drawer (?contact=<id|new>).

const PATH = "/money/contacts";
const t = money.contacts;
const signed = (v: number | null) => <Amount value={Number(v ?? 0)} format={formatMoney} />;

export async function ContactsTab({ sp }: { sp: Params }) {
  const { supabase, orgId, canEdit } = await requireInternal();
  const q = searchTerm(one(sp.q));
  const kept = { q: q ?? undefined };
  const editId = canEdit ? one(sp.contact) : null;

  let query = supabase.from("v_contact_rollup").select("*").eq("org_id", orgId).order("name");
  if (q) query = query.or(`name.ilike."*${q}*",afm.ilike."*${q}*"`);
  const [{ data: rollup, error }, { data: editing }] = await Promise.all([
    query,
    editId && editId !== "new"
      ? supabase.from("contacts").select("id, name, afm, phone, email").eq("org_id", orgId).eq("id", editId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (error) throw error;
  type Row = NonNullable<typeof rollup>[number];
  const c = el.contact;

  const columns: Column<Row>[] = [
    { key: "name", header: c.name, primary: true, cell: (r) => r.name ?? "—" },
    { key: "afm", header: c.afm, cell: (r) => <span className="num">{r.afm ?? "—"}</span> },
    { key: "in", header: c.totalIncome, numeric: true, cell: (r) => formatMoney(r.total_income) },
    { key: "out", header: c.totalExpense, numeric: true, cell: (r) => formatMoney(r.total_expense), hideOnCard: true },
    { key: "open", header: c.outstanding, numeric: true, cell: (r) => formatMoney(r.outstanding), hideOnCard: true },
    { key: "balance", header: c.netBalance, numeric: true, cell: (r) => signed(r.net_balance) },
  ];
  const closeHref = withParams(PATH, kept);

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          <>
            <ButtonLink href="/api/contacts/export" variant="secondary" size="sm">
              {t.export}
            </ButtonLink>
            {canEdit && (
              <ButtonLink href={withParams(PATH, kept, { contact: "new" })} size="sm">
                + {t.new}
              </ButtonLink>
            )}
          </>
        }
      >
        <Form action={PATH} className="w-full sm:w-80">
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder={t.search} aria-label={el.common.search} className="w-full" />
        </Form>
      </Toolbar>

      <DataTable
        rows={rollup ?? []}
        columns={columns}
        rowKey={(r) => r.contact_id ?? r.name ?? ""}
        empty={t.empty}
        rowActions={(r) => (
          <>
            {canEdit && <MenuLink href={withParams(PATH, kept, { contact: r.contact_id })}>{el.common.edit}</MenuLink>}
            <MenuLink href={withParams("/money", {}, { contact_id: r.contact_id })}>{t.transactions}</MenuLink>
            <MenuLink href={`/contacts/${r.contact_id}`}>{t.card}</MenuLink>
          </>
        )}
      />

      {(editId === "new" || editing) && (
        <UrlDrawer title={editing ? t.edit : t.new} action={saveContact.bind(null, editing?.id ?? null)} closeHref={closeHref}>
          <ContactFields initial={editing ?? undefined} />
        </UrlDrawer>
      )}
    </div>
  );
}
