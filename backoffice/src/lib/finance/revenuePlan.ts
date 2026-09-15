// The generalised calculation engine behind "hospitality revenue estimation"
// plans -- ported line-for-line from Glyfada_Hotel_Estimation.xlsx's own
// formulas (see its analysis), but with room_count and days-in-month as real
// fields instead of literals baked into 100+ near-duplicate formula cells.
// Nothing here is stored: exactly the "if it can change without anyone
// editing the row, it's a view" rule the rest of this app follows -- these
// functions ARE that view, just computed in TS instead of SQL because the
// room-type x year x month expansion is awkward to express relationally.

export interface RoomType {
  id: string;
  name: string;
  unitCount: number;
}

export interface Assumption {
  roomTypeId: string;
  yearNumber: number; // 1-based
  monthNumber: number; // 1-12
  occupancyPct: number; // 0-1
  adr: number;
}

export interface MonthCell {
  monthNumber: number;
  occupancyPct: number;
  adr: number;
  nightsSold: number;
  revenue: number;
}

export interface RoomTypeYear {
  roomTypeId: string;
  roomTypeName: string;
  yearNumber: number;
  months: MonthCell[];
  annualNights: number;
  annualRevenue: number;
  annualOccupancyPct: number; // SUM(nights)/(365*unitCount) -- matches the workbook
  annualAdr: number; // revenue-weighted, matches the workbook (not a simple average)
}

export interface YearTotal {
  yearNumber: number;
  monthlyRevenue: number[]; // index 0 = month 1
  annualRevenue: number;
}

export interface RevenuePlanResult {
  roomTypeYears: RoomTypeYear[];
  yearTotals: YearTotal[];
  grandTotal: number;
  summary: { roomTypeId: string; roomTypeName: string; byYear: number[]; total: number }[];
}

function daysInMonth(calendarYear: number, monthNumber: number): number {
  return new Date(calendarYear, monthNumber, 0).getDate();
}

export function computeRevenuePlan(
  startYear: number,
  roomTypes: RoomType[],
  assumptions: Assumption[],
): RevenuePlanResult {
  const byRoomYear = new Map<string, Assumption[]>();
  for (const a of assumptions) {
    const key = `${a.roomTypeId}:${a.yearNumber}`;
    const list = byRoomYear.get(key) ?? [];
    list.push(a);
    byRoomYear.set(key, list);
  }

  const roomTypeYears: RoomTypeYear[] = [];
  const years = new Set<number>();

  for (const rt of roomTypes) {
    for (const [key, list] of byRoomYear) {
      if (!key.startsWith(`${rt.id}:`)) continue;
      const yearNumber = list[0].yearNumber;
      years.add(yearNumber);
      const calendarYear = startYear + yearNumber - 1;

      const months: MonthCell[] = list
        .sort((a, b) => a.monthNumber - b.monthNumber)
        .map((a) => {
          const days = daysInMonth(calendarYear, a.monthNumber);
          const nightsSold = Math.round(a.occupancyPct * days * rt.unitCount);
          const revenue = Math.round(nightsSold * a.adr * 100) / 100;
          return { monthNumber: a.monthNumber, occupancyPct: a.occupancyPct, adr: a.adr, nightsSold, revenue };
        });

      const annualNights = months.reduce((s, m) => s + m.nightsSold, 0);
      const annualRevenue = Math.round(months.reduce((s, m) => s + m.revenue, 0) * 100) / 100;
      const annualOccupancyPct = annualNights / (365 * rt.unitCount);
      const annualAdr = annualNights > 0 ? Math.round((annualRevenue / annualNights) * 100) / 100 : 0;

      roomTypeYears.push({
        roomTypeId: rt.id,
        roomTypeName: rt.name,
        yearNumber,
        months,
        annualNights,
        annualRevenue,
        annualOccupancyPct,
        annualAdr,
      });
    }
  }

  const sortedYears = [...years].sort((a, b) => a - b);
  const yearTotals: YearTotal[] = sortedYears.map((yearNumber) => {
    const monthlyRevenue = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return roomTypeYears
        .filter((ry) => ry.yearNumber === yearNumber)
        .reduce((s, ry) => s + (ry.months.find((m) => m.monthNumber === month)?.revenue ?? 0), 0);
    });
    return {
      yearNumber,
      monthlyRevenue,
      annualRevenue: Math.round(monthlyRevenue.reduce((s, v) => s + v, 0) * 100) / 100,
    };
  });

  const summary = roomTypes.map((rt) => {
    const byYear = sortedYears.map(
      (y) => roomTypeYears.find((ry) => ry.roomTypeId === rt.id && ry.yearNumber === y)?.annualRevenue ?? 0,
    );
    return { roomTypeId: rt.id, roomTypeName: rt.name, byYear, total: Math.round(byYear.reduce((s, v) => s + v, 0) * 100) / 100 };
  });

  const grandTotal = Math.round(yearTotals.reduce((s, y) => s + y.annualRevenue, 0) * 100) / 100;

  return { roomTypeYears, yearTotals, grandTotal, summary };
}
