// Bank feed: fetch new transactions from every linked account and bring the
// ledger up to date, without ever adding the same payment twice.
//
// For each booked bank transaction (pending ones wait until booked):
//   1. already in the ledger -- paid row, same account, direction and amount,
//      date ±4 days, not already linked to another bank line  -> «matched»
//   2. an open row (pending/scheduled) with the same direction and amount,
//      due ±15 days (same account, or none set)                -> marked paid («paid»)
//   3. otherwise a new paid row                                 -> «added»
//      business account: no project yet, so it shows up in Ειδοποιήσεις
//      («Σε ποιο έργο;»); personal account: «Προσωπικά έξοδα».
// Then the bank's own balance is compared with the ledger balance.

import type { SupabaseClient } from "@supabase/supabase-js";
import { accountBalances, accountTransactions, type EbTransaction } from "./enableBanking";

const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const abs = (s: string) => Math.round(Math.abs(Number(s)) * 100) / 100;

async function refOf(t: EbTransaction, date: string) {
  if (t.entry_reference) return `e:${t.entry_reference}`;
  if (t.transaction_id) return `t:${t.transaction_id}`;
  const basis = [date, t.transaction_amount.amount, t.credit_debit_indicator, (t.remittance_information ?? []).join("|"), t.creditor?.name ?? "", t.debtor?.name ?? ""].join("~");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return "h:" + [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Link = { id: string; org_id: string; account_uid: string; account_id: string; sync_from: string | null; accounts: { name: string; owner_scope: string } | null };

export async function syncBank(supabase: SupabaseClient, orgId: string) {
  const { data: run } = await supabase.from("bank_sync_runs").insert({ org_id: orgId }).select("id").single();
  const counts = { fetched: 0, matched: 0, paid: 0, added: 0, pending: 0 };
  const balances: { account: string; bank: number; ledger: number; diff: number }[] = [];
  try {
    const { data: personalCat } = await supabase.from("categories").select("id").eq("org_id", orgId).eq("code", "ΠΡΟΣΩΠΙΚΆ_ΈΞΟΔΑ").maybeSingle();
    const { data: links, error } = await supabase
      .from("bank_links")
      .select("id, org_id, account_uid, account_id, sync_from, accounts(name, owner_scope), bank_connections!inner(status, valid_until)")
      .eq("org_id", orgId).eq("active", true).not("account_id", "is", null)
      .eq("bank_connections.status", "active");
    if (error) throw new Error(error.message);

    for (const raw of links ?? []) {
      const link = { ...raw, accounts: Array.isArray(raw.accounts) ? raw.accounts[0] : raw.accounts } as unknown as Link;
      const { data: last } = await supabase.from("bank_tx").select("booking_date").eq("link_id", link.id).not("booking_date", "is", null).order("booking_date", { ascending: false }).limit(1).maybeSingle();
      const from = last?.booking_date ? day(last.booking_date, -5) : (link.sync_from ?? new Date().toISOString().slice(0, 10));
      const txs = await accountTransactions(link.account_uid, from);
      counts.fetched += txs.length;
      const usedLedger = new Set<string>();

      for (const t of txs) {
        const date = t.booking_date ?? t.value_date ?? t.transaction_date;
        if (!date || (link.sync_from && date < link.sync_from)) continue;
        const ref = await refOf(t, date);
        const amount = abs(t.transaction_amount.amount);
        const direction = t.credit_debit_indicator === "CRDT" ? "income" : "expense";
        const booked = !t.status || t.status === "BOOK";
        const counterparty = (direction === "expense" ? t.creditor?.name : t.debtor?.name) ?? null;
        const description = [counterparty, ...(t.remittance_information ?? [])].filter(Boolean).join(" · ").slice(0, 300) || "Κίνηση τράπεζας";

        const { data: seen } = await supabase.from("bank_tx").select("id, outcome").eq("link_id", link.id).eq("ref", ref).maybeSingle();
        if (seen && seen.outcome !== "pending") continue;
        const base = { org_id: orgId, link_id: link.id, ref, booking_date: booked ? date : null, value_date: t.value_date ?? null, amount, direction, currency: t.transaction_amount.currency, bank_status: t.status ?? null, description, counterparty, raw: t as unknown as Record<string, unknown> };
        if (!booked) {
          if (!seen) await supabase.from("bank_tx").insert({ ...base, outcome: "pending" });
          counts.pending++;
          continue;
        }

        // 1. already in the ledger
        const { data: paidRows } = await supabase
          .from("transactions").select("id, paid_on, tx_date")
          .eq("org_id", orgId).eq("account_id", link.account_id).eq("status", "paid").eq("direction", direction)
          .gte("gross_amount", amount - 0.005).lte("gross_amount", amount + 0.005)
          .gte("tx_date", day(date, -10)).lte("tx_date", day(date, 10));
        const { data: linked } = await supabase.from("bank_tx").select("transaction_id").eq("org_id", orgId).in("transaction_id", (paidRows ?? []).map((r) => r.id).concat("00000000-0000-0000-0000-000000000000"));
        const taken = new Set([...(linked ?? []).map((r) => r.transaction_id), ...usedLedger]);
        const hit = (paidRows ?? [])
          .filter((r) => !taken.has(r.id) && Math.abs(Date.parse(String(r.paid_on ?? r.tx_date)) - Date.parse(date)) <= 4 * 86400000)
          .sort((a, b) => Math.abs(Date.parse(String(a.paid_on ?? a.tx_date)) - Date.parse(date)) - Math.abs(Date.parse(String(b.paid_on ?? b.tx_date)) - Date.parse(date)))[0];
        let outcome: "matched" | "paid" | "added";
        let txId: string;
        if (hit) {
          outcome = "matched";
          txId = hit.id;
        } else {
          // 2. an open row waiting for this payment
          const { data: openRows } = await supabase
            .from("transactions").select("id, due_date, tx_date, account_id, notes")
            .eq("org_id", orgId).in("status", ["pending", "scheduled"]).eq("direction", direction)
            .gte("gross_amount", amount - 0.005).lte("gross_amount", amount + 0.005)
            .or(`account_id.eq.${link.account_id},account_id.is.null`);
          const open = (openRows ?? [])
            .filter((r) => !usedLedger.has(r.id) && Math.abs(Date.parse(String(r.due_date ?? r.tx_date)) - Date.parse(date)) <= 15 * 86400000)
            .sort((a, b) => Number(/^\[/.test(a.notes ?? "")) - Number(/^\[/.test(b.notes ?? "")) || Math.abs(Date.parse(String(a.due_date ?? a.tx_date)) - Date.parse(date)) - Math.abs(Date.parse(String(b.due_date ?? b.tx_date)) - Date.parse(date)))[0];
          if (open) {
            const { error: e2 } = await supabase.from("transactions").update({ status: "paid", paid_on: date, account_id: link.account_id }).eq("id", open.id);
            if (e2) throw new Error(e2.message);
            outcome = "paid";
            txId = open.id;
          } else {
            // 3. new
            const personal = link.accounts?.owner_scope === "personal";
            const { data: row, error: e3 } = await supabase.from("transactions").insert({
              org_id: orgId, tx_date: date, paid_on: date, status: "paid", direction, origin: "bank_file",
              scope: personal ? "personal" : "business", account_id: link.account_id,
              category_id: personal && direction === "expense" ? personalCat?.id ?? null : null,
              gross_amount: amount, net_amount: amount, vat_amount: 0, withholding_amount: 0,
              counterparty_name: counterparty, description,
              notes: `Από την τράπεζα (αυτόματα, ${link.accounts?.name ?? ""}).`,
              legacy_excel_id: `bank:${link.id.slice(0, 8)}:${ref}`,
            }).select("id").single();
            if (e3) throw new Error(e3.message);
            outcome = "added";
            txId = row.id;
          }
        }
        usedLedger.add(txId);
        counts[outcome]++;
        if (seen) await supabase.from("bank_tx").update({ ...base, outcome, transaction_id: txId }).eq("id", seen.id);
        else await supabase.from("bank_tx").insert({ ...base, outcome, transaction_id: txId });
      }

      // Bank balance vs ledger balance
      const { balances: bb } = await accountBalances(link.account_uid);
      const pick = ["CLBD", "ITBD", "XPCD", "CLAV", "ITAV", "OTHR"].map((k) => bb.find((b) => b.balance_type === k)).find(Boolean) ?? bb[0];
      if (pick) {
        const bank = Math.round(Number(pick.balance_amount.amount) * 100) / 100;
        const { data: led } = await supabase.from("v_account_balances").select("current_balance").eq("account_id", link.account_id).maybeSingle();
        const ledger = Math.round(Number(led?.current_balance ?? 0) * 100) / 100;
        balances.push({ account: link.accounts?.name ?? link.account_id, bank, ledger, diff: Math.round((bank - ledger) * 100) / 100 });
        await supabase.from("bank_links").update({ last_bank_balance: bank, last_bank_balance_at: new Date().toISOString(), last_synced_at: new Date().toISOString() }).eq("id", link.id);
      }
    }
    await supabase.from("bank_sync_runs").update({ ...counts, balances, finished_at: new Date().toISOString() }).eq("id", run!.id);
    return { ...counts, balances };
  } catch (e) {
    await supabase.from("bank_sync_runs").update({ ...counts, balances, error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() }).eq("id", run!.id);
    throw e;
  }
}
