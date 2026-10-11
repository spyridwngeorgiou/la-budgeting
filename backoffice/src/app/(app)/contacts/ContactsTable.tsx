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

// Spec-sheet table: uppercase 12px head over the navy rule, hairline rows,
// figures right-aligned in tabular numerals.
const TH = "eyebrow border-b border-rule px-3 py-2.5 font-medium whitespace-nowrap text-muted";
const TD = "border-b border-hairline px-3 py-1 align-middle md:py-3";

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
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        placeholder="Αναζήτηση με όνομα ή ΑΦΜ…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-md:min-h-11 md:max-w-md"
      />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-body">
          <thead>
            <tr>
              <th scope="col" className={TH}>{el.contact.name}</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>{el.contact.afm}</th>
              <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>{el.contact.totalIncome}</th>
              <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>{el.contact.totalExpense}</th>
              <th scope="col" className={`${TH} hidden text-right md:table-cell`}>{el.contact.outstanding}</th>
              <th scope="col" className={`${TH} text-right`}>{el.contact.netBalance}</th>
            </tr>
          </thead>
          <tbody className="text-text">
            {visible.map((c) => (
              <tr key={c.contact_id} className="hover:bg-hover">
                <td className={`${TD} text-ink`}>
                  <Link
                    href={`/contacts/${c.contact_id}`}
                    className="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:min-h-0"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className={`${TD} num hidden text-muted md:table-cell`}>{c.afm ?? "—"}</td>
                <td className={`${TD} num hidden text-right sm:table-cell`}>{formatMoney(c.total_income)}</td>
                <td className={`${TD} num hidden text-right sm:table-cell`}>{formatMoney(c.total_expense)}</td>
                <td className={`${TD} num hidden text-right md:table-cell`}>{formatMoney(c.outstanding)}</td>
                <td className={`${TD} num text-right text-ink`}>{formatMoney(c.net_balance)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="border-b border-hairline px-3 py-8 text-muted">
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
