"use client";

import { useState } from "react";
import { Button, Drawer, StatusDot } from "@/components/ui";
import { STATUS_LABEL, type ChangeCard } from "@/lib/ai/changeCards";
import { el } from "@/lib/i18n/el";
import { ChangeCardView } from "./ChangeCardView";

// How many one-line rows the compact list shows before «▸ όλες (N)».
const COMPACT = 3;

const STATUS_TONE = { pending: "ai", conflict: "warning", approved: "positive", rejected: "neutral", failed: "negative" } as const;

// The pending AI changes of the «Εκκρεμότητες» panel. From 1280px (the
// panel is a column beside the chat) the cards themselves; below that one
// line each, so the chat keeps its height, and «Έλεγχος» opens the card --
// before/after and Έγκριση / Απόρριψη -- in a drawer.
export function PendingList({ cards }: { cards: ChangeCard[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const open = cards.find((c) => c.id === openId) ?? null;
  const a = el.assistant;
  const shown = all ? cards : cards.slice(0, COMPACT);

  return (
    <>
      <div className="hidden flex-col gap-4 xl:flex">
        {cards.map((c) => (
          <ChangeCardView key={c.id} initial={c} canReview />
        ))}
      </div>

      <div className="flex flex-col xl:hidden">
        <ul className="flex flex-col">
          {shown.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-3 border-b border-hairline py-1">
              <StatusDot tone={STATUS_TONE[c.status] ?? "neutral"} label={STATUS_LABEL[c.status] ?? c.status} showLabel={false} />
              <span className="min-w-0 flex-1 truncate text-body">
                <span className={c.operation === "delete" ? "text-negative" : "text-ink"}>{c.title}</span>
                {c.reason && <span className="text-muted"> · {c.reason}</span>}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpenId(c.id)}>
                {a.review}
              </Button>
            </li>
          ))}
        </ul>
        {cards.length > COMPACT && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
            className="flex min-h-11 items-center gap-2 text-left text-small text-muted hover:text-ink"
          >
            <span aria-hidden="true" className={`inline-block w-3 transition-transform ${all ? "rotate-90" : ""}`}>
              ▸
            </span>
            {a.allPending} (<span className="num">{cards.length}</span>)
          </button>
        )}
      </div>

      {open && (
        <Drawer onClose={() => setOpenId(null)} eyebrow={a.pendingItem} title={open.title}>
          <ChangeCardView initial={open} canReview />
        </Drawer>
      )}
    </>
  );
}
