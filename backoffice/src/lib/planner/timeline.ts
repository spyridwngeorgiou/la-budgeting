import { addMonths, diffDays, firstOfMonth, lastOfMonth, monthKeyOf } from "./dates";

// The Gantt's layout, as plain numbers: every bar is a left offset and a
// width in percent of the visible range, so the component is just absolutely
// positioned divs (no chart library, works at any width, prints).

export interface TimelineInput {
  id: string;
  start: string | null;
  end: string | null;
}

export interface TimelineBar {
  id: string;
  leftPct: number;
  widthPct: number;
  // Only one date known (or a milestone): drawn as a diamond, not a bar.
  isPoint: boolean;
  // Clipped at the edge of the visible range.
  startsBefore: boolean;
  endsAfter: boolean;
}

export interface TimelineMonth {
  key: string; // YYYY-MM
  leftPct: number;
  widthPct: number;
}

export interface Timeline {
  start: string;
  end: string;
  totalDays: number;
  months: TimelineMonth[];
  todayPct: number | null;
  bars: Record<string, TimelineBar>;
  // Ids with no date at all -- listed by the UI, not drawn.
  undated: string[];
}

function span(item: TimelineInput): { start: string; end: string; isPoint: boolean } | null {
  const s = item.start ?? item.end;
  const e = item.end ?? item.start;
  if (!s || !e) return null;
  if (e < s) return { start: s, end: s, isPoint: true };
  return { start: s, end: e, isPoint: item.start == null || item.end == null || s === e };
}

// Range defaults to whole months covering every dated item and today, so
// "now" is always on screen. Explicit from/to (ISO dates) override it.
export function computeTimeline(
  items: TimelineInput[],
  opts: { today: string; from?: string; to?: string },
): Timeline {
  const spans = new Map<string, NonNullable<ReturnType<typeof span>>>();
  const undated: string[] = [];
  for (const item of items) {
    const sp = span(item);
    if (sp) spans.set(item.id, sp);
    else undated.push(item.id);
  }

  let start = opts.from;
  let end = opts.to;
  if (!start || !end) {
    let min = opts.today;
    let max = opts.today;
    for (const sp of spans.values()) {
      if (sp.start < min) min = sp.start;
      if (sp.end > max) max = sp.end;
    }
    start ??= firstOfMonth(monthKeyOf(min));
    end ??= lastOfMonth(monthKeyOf(max));
  }
  if (end < start) end = start;

  const totalDays = diffDays(start, end) + 1;
  const pct = (days: number) => (days / totalDays) * 100;

  const months: TimelineMonth[] = [];
  for (let key = monthKeyOf(start); firstOfMonth(key) <= end; key = addMonths(key, 1)) {
    const mStart = firstOfMonth(key) < start ? start : firstOfMonth(key);
    const mEnd = lastOfMonth(key) > end ? end : lastOfMonth(key);
    months.push({ key, leftPct: pct(diffDays(start, mStart)), widthPct: pct(diffDays(mStart, mEnd) + 1) });
  }

  const bars: Record<string, TimelineBar> = {};
  for (const [id, sp] of spans) {
    if (sp.end < start || sp.start > end) continue;
    const s = sp.start < start ? start : sp.start;
    const e = sp.end > end ? end : sp.end;
    bars[id] = {
      id,
      leftPct: pct(diffDays(start, s)),
      widthPct: pct(diffDays(s, e) + 1),
      isPoint: sp.isPoint,
      startsBefore: sp.start < start,
      endsAfter: sp.end > end,
    };
  }

  const todayPct =
    opts.today >= start && opts.today <= end ? pct(diffDays(start, opts.today) + 0.5) : null;

  return { start, end, totalDays, months, todayPct, bars, undated };
}
