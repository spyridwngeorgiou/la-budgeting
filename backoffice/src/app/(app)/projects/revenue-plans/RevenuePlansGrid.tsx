"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { Input } from "@/components/ui";

export interface RevenuePlanRow {
  id: string;
  name: string;
  projectName: string | null;
  startYear: number;
  years: number;
  roomTypeCount: number;
  grandTotal: number;
}

function normalize(s: string) {
  return s.toLocaleLowerCase("el");
}

// A grid of cards was fine for a single plan; with one existing, this is
// the point to add search now rather than after there are 10-20 and finding
// the right one means scrolling through a wall of cards.
export function RevenuePlansGrid({ plans }: { plans: RevenuePlanRow[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return plans;
    return plans.filter(
      (p) => normalize(p.name).includes(q) || (p.projectName && normalize(p.projectName).includes(q)),
    );
  }, [plans, search]);

  if (plans.length === 0) {
    return <p className="border-b border-hairline py-3 text-body text-muted">Καμία ανάλυση ακόμα.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {plans.length > 5 && (
        <Input
          type="search"
          placeholder="Αναζήτηση σε όνομα ή έργο…"
          aria-label="Αναζήτηση σε όνομα ή έργο"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md max-md:min-h-11"
        />
      )}
      {visible.length === 0 ? (
        <p className="border-b border-hairline py-3 text-body text-muted">Καμία ανάλυση δεν ταιριάζει με την αναζήτηση.</p>
      ) : (
        // No cards: a block under a hairline that turns navy on hover.
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link
                href={`/projects/revenue-plans/${p.id}`}
                className="group flex h-full flex-col gap-1 border-t border-hairline pt-4 transition-colors hover:border-navy"
              >
                <span className="text-body break-words text-ink group-hover:underline group-hover:underline-offset-4">{p.name}</span>
                {p.projectName && <span className="text-small text-muted">{p.projectName}</span>}
                <span className="text-small text-muted">
                  <span className="num">
                    {p.startYear}–{p.startYear + p.years - 1}
                  </span>{" "}
                  · {p.roomTypeCount} τύποι δωματίων
                </span>
                <span className="num mt-3 text-figure-sm text-ink">{formatMoney(p.grandTotal)}</span>
                <span className="eyebrow text-muted">συνολικά έσοδα περιόδου</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
