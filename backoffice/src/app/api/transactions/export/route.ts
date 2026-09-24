import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TX_STATUS, TX_DIRECTION, type TxStatus, type TxDirection, type TxScope } from "@/lib/domain/enums";
import { toCsv, csvResponseHeaders } from "@/lib/csv";

// Before this route existed, there was no way for the owner to get their
// own ledger data out of the app independent of this UI -- fully locked
// into this one Supabase instance, unlike the spreadsheet it replaced,
// which could always just be opened directly. Reuses the same filter
// params as /transactions (status/direction/project_id/etc) so "export what
// I'm looking at" is exactly one click from the filtered table, but with no
// row cap -- an export is explicitly the escape hatch for when the on-screen
// 500-row limit isn't enough.

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  let query = supabase
    .from("transactions")
    .select(
      "tx_date, due_date, description, direction, status, scope, gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contacts(name), projects(display_name), categories(name), accounts(name)",
    )
    .order("tx_date", { ascending: false });

  const statusParam = params.get("status");
  const directionParam = params.get("direction");
  const projectId = params.get("project_id");
  const accountId = params.get("account_id");
  const contactId = params.get("contact_id");
  const categoryId = params.get("category_id");
  const scopeParam = params.get("scope");
  const from = params.get("from");
  const to = params.get("to");
  const ids = params.get("ids");

  const status = TX_STATUS.includes(statusParam as TxStatus) ? (statusParam as TxStatus) : null;
  const direction = TX_DIRECTION.includes(directionParam as TxDirection) ? (directionParam as TxDirection) : null;
  const scope = scopeParam === "business" || scopeParam === "personal" ? (scopeParam as TxScope) : null;

  if (status) query = query.eq("status", status);
  if (direction) query = query.eq("direction", direction);
  if (projectId) query = query.eq("project_id", projectId);
  if (accountId) query = query.eq("account_id", accountId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (scope) query = query.eq("scope", scope);
  if (from) query = query.gte("tx_date", from);
  if (to) query = query.lte("tx_date", to);
  if (ids) query = query.in("id", ids.split(",").filter(Boolean));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = [
    "Ημερομηνία",
    "Ημ/νία Λήξης",
    "Περιγραφή",
    "Κατεύθυνση",
    "Κατάσταση",
    "Πεδίο",
    "Επαφή",
    "Έργο",
    "Κατηγορία",
    "Καθαρή Αξία",
    "ΦΠΑ",
    "Ποσοστό ΦΠΑ",
    "Παρακράτηση",
    "Σύνολο",
    "Με Παραστατικό",
    "Αρ. Παραστατικού",
  ];
  const rows = (data ?? []).map((tx) => {
    const contact = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
    const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
    const category = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
    return [
      tx.tx_date,
      tx.due_date ?? "",
      tx.description ?? "",
      tx.direction === "income" ? "Έσοδο" : "Έξοδο",
      tx.status,
      tx.scope ?? "",
      contact?.name ?? "",
      project?.display_name ?? "",
      category?.name ?? "",
      tx.net_amount,
      tx.vat_amount,
      tx.vat_rate ?? "",
      tx.withholding_amount,
      tx.gross_amount,
      tx.has_invoice ? "Ναι" : "Όχι",
      tx.invoice_number ?? "",
    ];
  });

  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders("kiniseis") });
}
