import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { applyMoneyManager } from "./actions";

// Μετρητά (Money Manager) -- what the phone sent and what is new. Rows already
// in the ledger are only counted. For each new row: «Προσωπικά», a project, or
// «Παράλειψη»; one button applies them all.

export default async function MoneyManagerPage() {
  const supabase = await createClient();
  const [{ data: imports }, { data: projects }] = await Promise.all([
    supabase.from("mm_imports").select("*").order("received_at", { ascending: false }).limit(10),
    supabase.from("projects").select("id, display_name").order("sort_order"),
  ]);
  const open = (imports ?? []).filter((i) => i.status === "draft");
  const { data: rows } = open.length
    ? await supabase.from("mm_rows").select("*").in("import_id", open.map((i) => i.id)).eq("match_status", "new").is("committed_transaction_id", null).neq("decision", "skip").order("tx_date")
    : { data: [] };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Μετρητά — Money Manager</h1>
        <p className="text-sm text-ink-muted">
          Στο iPhone: Money Manager → Backup σε Excel → «Στείλε στην Kansha». Ό,τι υπάρχει ήδη αγνοείται· εδώ μένουν μόνο τα νέα.
        </p>
      </div>

      {open.map((imp) => {
        const mine = (rows ?? []).filter((r) => r.import_id === imp.id);
        return (
          <form key={imp.id} action={applyMoneyManager.bind(null, imp.id)} className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">
                Αρχείο {formatDate(imp.period_from)} – {formatDate(imp.period_to)}
              </span>
              <span className="text-xs text-ink-muted">
                {imp.row_count} κινήσεις · {imp.row_count - imp.new_count} υπήρχαν ήδη · <b>{mine.length} για απόφαση</b>
              </span>
            </div>
            {mine.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-faint">Τίποτα νέο.</p>
            ) : (
              <ul className="divide-y divide-line">
                {mine.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                    <span className="w-20 text-xs tabular-nums text-ink-muted">{formatDate(r.tx_date)}</span>
                    <span className="min-w-0 flex-1">
                      {[r.category, r.subcategory].filter(Boolean).join(" · ") || "—"}
                      {r.note && <span className="block text-xs text-ink-muted">{r.note}</span>}
                    </span>
                    <span className={`tabular-nums ${r.kind === "income" ? "text-sage-ink" : ""}`}>
                      {r.kind === "income" ? "+" : "−"}{formatMoney(Number(r.amount))}
                    </span>
                    <select name={`d_${r.id}`} defaultValue={r.decision === "personal" ? "personal" : ""} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                      <option value="">— διάλεξε —</option>
                      <option value="personal">Προσωπικά</option>
                      {(projects ?? []).map((p) => <option key={p.id} value={`project:${p.id}`}>Έργο: {p.display_name}</option>)}
                      <option value="skip">Παράλειψη</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {mine.length > 0 && (
              <div className="flex justify-end border-t border-line px-4 py-3">
                <SubmitButton pendingLabel="Καταχώριση…">Καταχώριση επιλογών</SubmitButton>
              </div>
            )}
          </form>
        );
      })}

      {open.length === 0 && <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-muted">Όλα καταχωρημένα. Τίποτα δεν περιμένει.</p>}
    </div>
  );
}
