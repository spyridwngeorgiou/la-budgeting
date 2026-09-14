"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Input } from "@/components/ui";

interface ContactRow {
  contact_id: string | null;
  name: string | null;
  afm: string | null;
  total_income: number | null;
  total_expense: number | null;
  outstanding: number | null;
  net_balance: number | null;
}

function normalize(s: string) {
  return s.toLocaleLowerCase("el");
}

export function ContactsTable({ rollup }: { rollup: ContactRow[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return rollup;
    return rollup.filter(
      (c) => normalize(c.name ?? "").includes(q) || (c.afm ?? "").includes(q),
    );
  }, [rollup, search]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        placeholder="Αναζήτηση με όνομα ή ΑΦΜ…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">{el.contact.name}</th>
              <th className="p-2">{el.contact.afm}</th>
              <th className="p-2 text-right">{el.contact.totalIncome}</th>
              <th className="p-2 text-right">{el.contact.totalExpense}</th>
              <th className="p-2 text-right">{el.contact.outstanding}</th>
              <th className="p-2 text-right">{el.contact.netBalance}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.contact_id} className="border-t border-line">
                <td className="p-2">
                  <Link href={`/contacts/${c.contact_id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-2 font-mono text-xs text-ink-muted">{c.afm ?? "—"}</td>
                <td className="p-2 text-right font-mono">{formatMoney(c.total_income)}</td>
                <td className="p-2 text-right font-mono">{formatMoney(c.total_expense)}</td>
                <td className="p-2 text-right font-mono">{formatMoney(c.outstanding)}</td>
                <td className="p-2 text-right font-mono">{formatMoney(c.net_balance)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-ink-muted">
                  {rollup.length === 0
                    ? "Δεν υπάρχουν ακόμα επαφές. Πατήστε «+ Νέα Επαφή» για να ξεκινήσετε."
                    : "Καμία επαφή δεν ταιριάζει με την αναζήτηση."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
