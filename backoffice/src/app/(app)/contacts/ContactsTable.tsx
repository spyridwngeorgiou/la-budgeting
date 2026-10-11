"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Input, LINK_CLASS, SpecTable, Td, Th, Tr } from "@/components/ui";

interface ContactRow {
  contact_id: string | null;
  name: string | null;
  afm: string | null;
  total_income: number | null;
  total_expense: number | null;
  outstanding: number | null;
  net_balance: number | null;
}

// Rows sit tighter on a phone (the name link carries the 44px target).
const CELL = "max-md:py-1 max-md:align-middle md:align-middle";

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

      <SpecTable label="Επαφές">
        <thead>
          <tr>
            <Th>{el.contact.name}</Th>
            <Th className="hidden md:table-cell">{el.contact.afm}</Th>
            <Th numeric className="hidden sm:table-cell">
              {el.contact.totalIncome}
            </Th>
            <Th numeric className="hidden sm:table-cell">
              {el.contact.totalExpense}
            </Th>
            <Th numeric className="hidden md:table-cell">
              {el.contact.outstanding}
            </Th>
            <Th numeric>{el.contact.netBalance}</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <Tr key={c.contact_id}>
              <Td className={CELL}>
                <Link href={`/contacts/${c.contact_id}`} className={`${LINK_CLASS} inline-flex min-h-11 items-center md:min-h-0`}>
                  {c.name}
                </Link>
              </Td>
              <Td className={`${CELL} num hidden md:table-cell`}>
                <span className="text-muted">{c.afm ?? "—"}</span>
              </Td>
              <Td numeric className={`${CELL} hidden sm:table-cell`}>
                {formatMoney(c.total_income)}
              </Td>
              <Td numeric className={`${CELL} hidden sm:table-cell`}>
                {formatMoney(c.total_expense)}
              </Td>
              <Td numeric className={`${CELL} hidden md:table-cell`}>
                {formatMoney(c.outstanding)}
              </Td>
              <Td numeric strong className={CELL}>
                {formatMoney(c.net_balance)}
              </Td>
            </Tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <Td colSpan={6} className="py-8">
                <span className="text-muted">
                  {rollup.length === 0
                    ? "Δεν υπάρχουν ακόμα επαφές. Πατήστε «+ Νέα Επαφή» για να ξεκινήσετε."
                    : "Καμία επαφή δεν ταιριάζει με την αναζήτηση."}
                </span>
              </Td>
            </tr>
          )}
        </tbody>
      </SpecTable>
    </div>
  );
}
