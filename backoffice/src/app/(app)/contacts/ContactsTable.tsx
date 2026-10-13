"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { withParams } from "@/lib/url";
import { Button, EmptyState, Input, LINK_CLASS, SpecTable, Td, Th, Tr } from "@/components/ui";
import { ContactFormDrawer, type ContactValues } from "./ContactForm";

export interface ContactRow {
  contact_id: string | null;
  name: string | null;
  afm: string | null;
  phone: string | null;
  email: string | null;
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

// The search lives in the URL (?q=, shareable, kept on reload and on the way
// back from a contact) but filters here, as you type: the address changes
// with history.replaceState, which Next keeps in sync without a server
// round trip -- a moment after the last key (browsers cap how often a page
// may rewrite its address).
function writeQuery(q: string) {
  try {
    const url = new URL(window.location.href);
    window.history.replaceState(null, "", withParams(url.pathname, url.searchParams, { q: q.trim() || null }));
  } catch {
    // Over the browser's rate limit: the list is filtered all the same.
  }
}

export function ContactsTable({ rollup, initialQuery = "" }: { rollup: ContactRow[]; initialQuery?: string }) {
  const [search, setSearch] = useState(initialQuery);
  const [editing, setEditing] = useState<ContactValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = el.contact;

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return rollup;
    return rollup.filter((r) => normalize(r.name ?? "").includes(q) || (r.afm ?? "").includes(q));
  }, [rollup, search]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setQuery = (q: string, now = false) => {
    setSearch(q);
    if (timer.current) clearTimeout(timer.current);
    if (now) writeQuery(q);
    else timer.current = setTimeout(() => writeQuery(q), 300);
  };

  if (rollup.length === 0) return <EmptyState title={c.empty} body={c.emptyHint} />;

  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={c.search}
          placeholder={c.search}
          value={search}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-md:min-h-11 md:max-w-md"
        />
        {search && (
          <Button type="button" variant="ghost" onClick={() => setQuery("", true)}>
            {c.clearSearch}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={c.noMatch}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => setQuery("", true)}>
              {c.clearSearch}
            </Button>
          }
        />
      ) : (
        <SpecTable label={el.nav.contacts}>
          <thead>
            <tr>
              <Th>{c.name}</Th>
              <Th className="hidden md:table-cell">{c.afm}</Th>
              <Th numeric className="hidden sm:table-cell">
                {c.totalIncome}
              </Th>
              <Th numeric className="hidden sm:table-cell">
                {c.totalExpense}
              </Th>
              <Th numeric className="hidden md:table-cell">
                {c.outstanding}
              </Th>
              <Th numeric>{c.netBalance}</Th>
              <Th>
                <span className="sr-only">{el.common.edit}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Tr key={r.contact_id}>
                <Td className={CELL}>
                  <Link href={`/contacts/${r.contact_id}`} className={`${LINK_CLASS} inline-flex min-h-11 items-center md:min-h-0`}>
                    {r.name}
                  </Link>
                </Td>
                <Td className={`${CELL} num hidden md:table-cell`}>
                  <span className="text-muted">{r.afm ?? "—"}</span>
                </Td>
                <Td numeric className={`${CELL} hidden sm:table-cell`}>
                  {formatMoney(r.total_income)}
                </Td>
                <Td numeric className={`${CELL} hidden sm:table-cell`}>
                  {formatMoney(r.total_expense)}
                </Td>
                <Td numeric className={`${CELL} hidden md:table-cell`}>
                  {formatMoney(r.outstanding)}
                </Td>
                <Td numeric strong className={CELL}>
                  {formatMoney(r.net_balance)}
                </Td>
                <Td className={`${CELL} text-right`}>
                  {r.contact_id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${el.common.edit}: ${r.name ?? ""}`}
                      onClick={() =>
                        setEditing({ id: r.contact_id!, name: r.name ?? "", afm: r.afm, phone: r.phone, email: r.email })
                      }
                    >
                      {el.common.edit}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </SpecTable>
      )}

      {editing && <ContactFormDrawer contact={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
