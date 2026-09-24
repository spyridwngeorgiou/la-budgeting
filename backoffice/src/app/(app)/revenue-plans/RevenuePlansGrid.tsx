"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { Card, Input } from "@/components/ui";

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
    return <p className="text-sm text-ink-faint">Καμία ανάλυση ακόμα.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {plans.length > 5 && (
        <Input
          type="search"
          placeholder="Αναζήτηση σε όνομα ή έργο…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-ink-faint">Καμία ανάλυση δεν ταιριάζει με την αναζήτηση.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <Link key={p.id} href={`/revenue-plans/${p.id}`}>
              <Card className="h-full transition-colors hover:border-line-strong hover:bg-bg">
                <div className="text-sm font-medium">{p.name}</div>
                {p.projectName && <div className="text-xs text-ink-muted">{p.projectName}</div>}
                <div className="mt-2 text-xs text-ink-muted">
                  {p.startYear}–{p.startYear + p.years - 1} · {p.roomTypeCount} τύποι δωματίων
                </div>
                <div className="mt-2 font-mono text-lg">{formatMoney(p.grandTotal)}</div>
                <div className="text-xs text-ink-faint">συνολικά έσοδα περιόδου</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
