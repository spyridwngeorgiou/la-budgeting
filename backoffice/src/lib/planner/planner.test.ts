import { describe, expect, it } from "vitest";
import { plannerCapabilities } from "./access";
import {
  addDays,
  addMonths,
  diffDays,
  isIsoDate,
  lastOfMonth,
  parseMonthParam,
  todayAthens,
  weekdayMonFirst,
} from "@/lib/dates";
import { keyAtEnd, keyBetween, MIN_GAP, planMove, SORT_STEP } from "./sortKey";
import { computeTimeline } from "./timeline";
import {
  agendaDays,
  filterCalendarItems,
  groupByDay,
  monthCells,
  monthGridRange,
  toCalendarItems,
  type CalendarItem,
} from "./calendar";

describe("todayAthens", () => {
  it("is already tomorrow in Athens late in the UTC evening (summer, UTC+3)", () => {
    expect(todayAthens(new Date("2026-07-09T21:30:00Z"))).toBe("2026-07-10");
    expect(todayAthens(new Date("2026-07-09T20:59:00Z"))).toBe("2026-07-09");
  });
  it("follows the winter offset (UTC+2)", () => {
    expect(todayAthens(new Date("2026-01-09T22:00:00Z"))).toBe("2026-01-10");
    expect(todayAthens(new Date("2026-01-09T21:59:00Z"))).toBe("2026-01-09");
  });
  it("rolls the year over at Athens midnight", () => {
    expect(todayAthens(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
  });
});

describe("date helpers", () => {
  it("adds and diffs days across month and leap boundaries", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDays("2026-10-01", "2026-10-31")).toBe(30);
    expect(diffDays("2026-10-31", "2026-10-01")).toBe(-30);
  });
  it("crosses the DST switch without losing a day", () => {
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it("handles months", () => {
    expect(lastOfMonth("2026-02")).toBe("2026-02-28");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(parseMonthParam("2026-13", "2026-10-09")).toBe("2026-10");
    expect(parseMonthParam(["2027-03"], "2026-10-09")).toBe("2027-03");
    expect(parseMonthParam(undefined, "2026-10-09")).toBe("2026-10");
  });
  it("numbers weekdays Monday-first", () => {
    expect(weekdayMonFirst("2026-10-05")).toBe(0); // Monday
    expect(weekdayMonFirst("2026-10-11")).toBe(6); // Sunday
  });
});

describe("sortKey", () => {
  it("takes the midpoint, or steps past an open end", () => {
    expect(keyBetween(1024, 2048)).toBe(1536);
    expect(keyBetween(null, 1024)).toBe(0);
    expect(keyBetween(1024, null)).toBe(1024 + SORT_STEP);
    expect(keyBetween(null, null)).toBe(SORT_STEP);
  });
  it("plans a single-row move between neighbours", () => {
    const plan = planMove(
      [
        { id: "a", sort_key: 1024 },
        { id: "x", sort_key: 99999 },
        { id: "b", sort_key: 2048 },
      ],
      "x",
    );
    expect(plan).toEqual({ sortKey: 1536 });
  });
  it("moves to the top and bottom of a column", () => {
    expect(planMove([{ id: "x", sort_key: 5 }, { id: "a", sort_key: 1024 }], "x").sortKey).toBe(0);
    expect(planMove([{ id: "a", sort_key: 1024 }, { id: "x", sort_key: 5 }], "x").sortKey).toBe(2048);
    expect(planMove([{ id: "x", sort_key: 5 }], "x").sortKey).toBe(SORT_STEP);
  });
  it("rebalances the column once the gap is too small to split", () => {
    const plan = planMove(
      [
        { id: "a", sort_key: 1 },
        { id: "x", sort_key: 0 },
        { id: "b", sort_key: 1 + MIN_GAP / 2 },
        { id: "c", sort_key: 9 },
      ],
      "x",
    );
    expect(plan.rebalanced).toEqual([
      { id: "a", sort_key: 1024 },
      { id: "x", sort_key: 2048 },
      { id: "b", sort_key: 3072 },
      { id: "c", sort_key: 4096 },
    ]);
    expect(plan.sortKey).toBe(2048);
  });
  it("rebalances when neighbours are out of order", () => {
    const plan = planMove(
      [
        { id: "a", sort_key: 10 },
        { id: "x", sort_key: 0 },
        { id: "b", sort_key: 5 },
      ],
      "x",
    );
    expect(plan.rebalanced).toHaveLength(3);
  });
  it("survives many halvings into the same gap", () => {
    let lo = 1024;
    const hi = 2048;
    for (let i = 0; i < 60; i++) {
      const plan = planMove(
        [
          { id: "a", sort_key: lo },
          { id: "x", sort_key: 0 },
          { id: "b", sort_key: hi },
        ],
        "x",
      );
      if (plan.rebalanced) return; // renumbered before precision ran out
      expect(plan.sortKey).toBeGreaterThan(lo);
      expect(plan.sortKey).toBeLessThan(hi);
      lo = plan.sortKey;
    }
    throw new Error("never rebalanced");
  });
  it("appends after the largest key", () => {
    expect(keyAtEnd([])).toBe(SORT_STEP);
    expect(keyAtEnd([{ id: "a", sort_key: 3000 }, { id: "b", sort_key: 1000 }])).toBe(3000 + SORT_STEP);
  });
});

describe("computeTimeline", () => {
  it("covers whole months around the items and today", () => {
    const t = computeTimeline(
      [
        { id: "p1", start: "2026-10-10", end: "2026-11-20" },
        { id: "m1", start: null, end: "2026-12-05" },
        { id: "u", start: null, end: null },
      ],
      { today: "2026-10-09" },
    );
    expect(t.start).toBe("2026-10-01");
    expect(t.end).toBe("2026-12-31");
    expect(t.totalDays).toBe(92);
    expect(t.months.map((m) => m.key)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(t.months.reduce((s, m) => s + m.widthPct, 0)).toBeCloseTo(100);
    expect(t.undated).toEqual(["u"]);
    expect(t.bars.m1.isPoint).toBe(true);
    expect(t.bars.p1.isPoint).toBe(false);
    expect(t.bars.p1.leftPct).toBeCloseTo((9 / 92) * 100);
    expect(t.bars.p1.widthPct).toBeCloseTo((42 / 92) * 100);
    expect(t.todayPct).toBeCloseTo((8.5 / 92) * 100);
  });
  it("clips bars to an explicit range and drops ones outside it", () => {
    const t = computeTimeline(
      [
        { id: "long", start: "2026-01-01", end: "2027-06-30" },
        { id: "gone", start: "2025-01-01", end: "2025-02-01" },
      ],
      { today: "2026-10-09", from: "2026-10-01", to: "2026-10-31" },
    );
    expect(t.bars.long).toMatchObject({ leftPct: 0, widthPct: 100, startsBefore: true, endsAfter: true });
    expect(t.bars.gone).toBeUndefined();
  });
  it("treats an inverted range as a point on its start", () => {
    const t = computeTimeline([{ id: "x", start: "2026-10-20", end: "2026-10-10" }], { today: "2026-10-09" });
    expect(t.bars.x.isPoint).toBe(true);
  });
  it("hides the today marker outside the range", () => {
    const t = computeTimeline([], { today: "2026-10-09", from: "2027-01-01", to: "2027-01-31" });
    expect(t.todayPct).toBeNull();
  });
});

function item(partial: Partial<CalendarItem> & { item_key: string; starts_on: string }): CalendarItem {
  return {
    source: "task",
    subkind: null,
    org_id: "o",
    project_id: null,
    ref_id: null,
    ends_on: partial.starts_on,
    title: partial.item_key,
    status: null,
    is_done: false,
    is_financial: false,
    amount: null,
    direction: null,
    ...partial,
  };
}

describe("calendar", () => {
  it("builds Monday-first whole weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(monthGridRange("2026-10")).toEqual({ start: "2026-09-28", end: "2026-11-01" });
    const cells = monthCells("2026-10");
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ dateIso: "2026-09-28", day: 28, inMonth: false });
    expect(cells[3]).toEqual({ dateIso: "2026-10-01", day: 1, inMonth: true });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });
  it("handles a month that starts on Monday", () => {
    expect(monthGridRange("2027-02")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });
  it("spreads short ranges, pins long ones to their ends", () => {
    const range = { start: "2026-09-28", end: "2026-11-01" };
    const byDay = groupByDay(
      [
        item({ item_key: "short", starts_on: "2026-10-05", ends_on: "2026-10-07" }),
        item({ item_key: "long", source: "phase", starts_on: "2026-10-02", ends_on: "2026-12-31" }),
      ],
      range,
    );
    expect(byDay.get("2026-10-06")?.map((i) => i.item_key)).toEqual(["short"]);
    expect(byDay.get("2026-10-02")?.map((i) => i.item_key)).toEqual(["long"]);
    expect(byDay.has("2026-10-03")).toBe(false);
    expect(byDay.has("2026-12-31")).toBe(false); // outside the grid
  });
  it("sorts each day open-first, then by source", () => {
    const byDay = groupByDay(
      [
        item({ item_key: "vat", source: "vat", starts_on: "2026-10-31" }),
        item({ item_key: "done", starts_on: "2026-10-31", is_done: true }),
        item({ item_key: "task", starts_on: "2026-10-31" }),
      ],
      { start: "2026-10-01", end: "2026-10-31" },
    );
    expect(byDay.get("2026-10-31")?.map((i) => i.item_key)).toEqual(["task", "vat", "done"]);
  });
  it("lists the agenda by start day, clamping items already under way", () => {
    const days = agendaDays(
      [
        item({ item_key: "b", starts_on: "2026-10-20" }),
        item({ item_key: "a", source: "phase", starts_on: "2026-09-01", ends_on: "2026-10-15" }),
        item({ item_key: "out", starts_on: "2026-11-20" }),
      ],
      { start: "2026-10-01", end: "2026-10-31" },
    );
    expect(days.map((d) => [d.dateIso, d.items.map((i) => i.item_key)])).toEqual([
      ["2026-10-01", ["a"]],
      ["2026-10-20", ["b"]],
    ]);
  });
  it("filters by source and hides financial rows", () => {
    const items = [
      item({ item_key: "t", starts_on: "2026-10-01" }),
      item({ item_key: "p", source: "payment", starts_on: "2026-10-01", is_financial: true }),
    ];
    expect(filterCalendarItems(items, { showFinancial: false }).map((i) => i.item_key)).toEqual(["t"]);
    expect(filterCalendarItems(items, { showFinancial: true, sources: ["payment"] }).map((i) => i.item_key)).toEqual([
      "p",
    ]);
  });
  it("drops view rows missing their essentials", () => {
    const base = {
      item_key: "k",
      source: "task",
      subkind: null,
      org_id: "o",
      project_id: null,
      ref_id: null,
      starts_on: "2026-10-01",
      ends_on: null,
      title: null,
      status: null,
      is_done: null,
      is_financial: null,
      amount: null,
      direction: null,
    };
    const out = toCalendarItems([base, { ...base, item_key: "bad", source: "nope" }, { ...base, starts_on: null }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ends_on: "2026-10-01", title: "", is_done: false });
  });
});

describe("plannerCapabilities", () => {
  it("mirrors the RLS matrix", () => {
    expect(plannerCapabilities({ kind: "member", role: "viewer" })).toEqual({
      canWriteTasks: false,
      canComment: true,
      canEditSchedule: false,
      canDelete: false,
      canSeeFinancial: true,
    });
    expect(plannerCapabilities({ kind: "member", role: "editor" })).toEqual({
      canWriteTasks: true,
      canComment: true,
      canEditSchedule: true,
      canDelete: true,
      canSeeFinancial: true,
    });
    expect(plannerCapabilities({ kind: "partner", projectRole: "contributor" })).toEqual({
      canWriteTasks: true,
      canComment: true,
      canEditSchedule: false,
      canDelete: false,
      canSeeFinancial: false,
    });
    expect(plannerCapabilities({ kind: "partner", projectRole: "guest" })).toEqual({
      canWriteTasks: false,
      canComment: true,
      canEditSchedule: false,
      canDelete: false,
      canSeeFinancial: false,
    });
  });
});
