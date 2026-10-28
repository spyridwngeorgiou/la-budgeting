import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { BANKS } from "@/lib/bank/service";
import { connectBank, mapLink, syncNow } from "./actions";

// Τράπεζες -- the live feed. Three blocks, top to bottom:
//   1. connected accounts: which ledger account each feeds, bank balance vs
//      ledger balance, consent expiry
//   2. connect a bank (read-only consent on the bank's own page, 180 days)
//   3. the last runs (3 a day, or «Συγχρονισμός τώρα»)

const OUTCOME: Record<string, string> = { matched: "υπήρχαν ήδη", paid: "πληρώθηκαν από προγραμματισμένα", added: "νέες", pending: "εκκρεμούν στην τράπεζα" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { connected, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: conns }, { data: links }, { data: accounts }, { data: balances }, { data: runs }] = await Promise.all([
    supabase.from("bank_connections").select("id, aspsp_name, psu_type, status, valid_until, created_at").neq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("bank_links").select("id, connection_id, iban, bank_account_no, name, account_id, last_bank_balance, last_bank_balance_at, last_synced_at"),
    supabase.from("accounts").select("id, name").order("name"),
    supabase.from("v_account_balances").select("account_id, current_balance"),
    supabase.from("bank_sync_runs").select("*").order("started_at", { ascending: false }).limit(8),
  ]);
  const ledgerBalance = new Map((balances ?? []).map((b) => [b.account_id, Number(b.current_balance)]));
  const soon = (d: string | null) => !!d && Date.parse(d) - Date.now() < 14 * 86400000;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Τράπεζες</h1>
        <p className="text-sm text-ink-muted">
          Αυτόματη λήψη κινήσεων 3 φορές τη μέρα (07:00 · 13:00 · 19:00). Μόνο ανάγνωση — η εφαρμογή δεν μπορεί να κάνει πληρωμές. Ό,τι υπάρχει ήδη δεν ξαναμπαίνει.
        </p>
      </div>
      {connected && <p className="rounded-lg border border-sage-strong bg-sage/40 px-4 py-3 text-sm">✓ Η τράπεζα συνδέθηκε. Έλεγξε παρακάτω σε ποιον λογαριασμό πάει κάθε τραπεζικός λογαριασμός και πάτα «Συγχρονισμός τώρα».</p>}
      {error && <p className="rounded-lg border border-red-ink/30 bg-red-bg px-4 py-3 text-sm text-red-ink">{error}</p>}

      {/* 1. Συνδεδεμένοι λογαριασμοί */}
      <section className="rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Συνδεδεμένοι λογαριασμοί</h2>
        {(conns ?? []).length === 0 && <p className="px-4 py-3 text-sm text-ink-faint">Καμία τράπεζα ακόμα — σύνδεσε από κάτω.</p>}
        <ul className="divide-y divide-line">
          {(conns ?? []).flatMap((c) =>
            (links ?? []).filter((l) => l.connection_id === c.id).map((l) => {
              const ledger = l.account_id ? ledgerBalance.get(l.account_id) : undefined;
              const diff = l.last_bank_balance != null && ledger != null ? Math.round((Number(l.last_bank_balance) - ledger) * 100) / 100 : null;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.aspsp_name}</span> · {l.name ?? "λογαριασμός"} {l.iban ?? l.bank_account_no ?? ""}
                    <span className={`block text-xs ${c.status !== "active" || soon(c.valid_until) ? "text-red-ink" : "text-ink-muted"}`}>
                      {c.status === "active" ? `έγκριση έως ${formatDate(c.valid_until)}${soon(c.valid_until) ? " — ανανέωσέ την" : ""}` : `κατάσταση: ${c.status}`}
                      {l.last_synced_at ? ` · τελευταία λήψη ${new Date(l.last_synced_at).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" })}` : ""}
                    </span>
                  </span>
                  <form action={mapLink.bind(null, l.id)} className="flex items-center gap-2">
                    <select name="account_id" defaultValue={l.account_id ?? ""} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                      <option value="">— σε ποιον λογαριασμό; —</option>
                      {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button className="text-xs text-ink-muted underline">αποθήκευση</button>
                  </form>
                  {l.last_bank_balance != null && (
                    <span className="w-56 text-right text-xs tabular-nums">
                      τράπεζα {formatMoney(Number(l.last_bank_balance))}
                      {diff != null && <span className={`block ${Math.abs(diff) < 0.01 ? "text-sage-ink" : "text-red-ink"}`}>{Math.abs(diff) < 0.01 ? "✓ ίδιο με την εφαρμογή" : `διαφορά ${formatMoney(diff)}`}</span>}
                    </span>
                  )}
                </li>
              );
            }),
          )}
        </ul>
        {(links ?? []).some((l) => l.account_id) && (
          <form action={syncNow} className="flex justify-end border-t border-line px-4 py-3">
            <SubmitButton pendingLabel="Λήψη…">Συγχρονισμός τώρα</SubmitButton>
          </form>
        )}
      </section>

      {/* 2. Σύνδεση τράπεζας */}
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Σύνδεση τράπεζας</h2>
        <p className="mb-3 text-xs text-ink-muted">Ανοίγει η σελίδα της τράπεζας· μπαίνεις όπως στο e-banking και εγκρίνεις μόνο ανάγνωση. Οι κωδικοί σου μένουν στην τράπεζα. Η έγκριση κρατά 180 ημέρες.</p>
        <div className="flex flex-wrap gap-2">
          {BANKS.map((b, i) => (
            <form key={b.label} action={connectBank.bind(null, i)}>
              <button className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-bg">{b.label}</button>
            </form>
          ))}
        </div>
      </section>

      {/* 3. Τελευταίες λήψεις */}
      <section className="rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Τελευταίες λήψεις</h2>
        {(runs ?? []).length === 0 && <p className="px-4 py-3 text-sm text-ink-faint">Καμία ακόμα.</p>}
        <ul className="divide-y divide-line text-sm">
          {(runs ?? []).map((r) => (
            <li key={r.id} className="px-4 py-2">
              <span className="text-xs tabular-nums text-ink-muted">{new Date(r.started_at).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" })}</span>{" "}
              {r.error ? (
                <span className="text-red-ink">Σφάλμα: {r.error}</span>
              ) : (
                <span>
                  {r.fetched} κινήσεις · {(["added", "paid", "matched", "pending"] as const).filter((k) => r[k] > 0).map((k) => `${r[k]} ${OUTCOME[k]}`).join(" · ") || "τίποτα νέο"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
