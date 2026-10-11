// The one formatter for what the UI prints: money, percentages, plain
// numbers, durations, sizes and dates, all in Greek (comma decimals, dot
// thousands). Two house rules on top of Intl:
//   - a negative number carries the true minus «−» (U+2212), never the
//     hyphen and never a space after it: «−61,53 €»;
//   - in a table a zero may read «—» (moneyOrDash), so real figures stand out.
// A percentage beyond ±1000% is not a figure anyone can act on (an IRR of
// «17126,2%» means the inputs are off), so it reads «—».

export const MINUS = "−";
export const DASH = "—";

const currencyFormatter = new Intl.NumberFormat("el-GR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// Date-only ISO strings («2026-10-09») are calendar days: format them in UTC
// so a browser west of Greenwich does not show the day before.
const isoDayFormatter = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("el-GR", { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormatters.set(key, f);
  }
  return f;
}

// Intl writes the hyphen-minus; swap it for the true minus.
const trueMinus = (s: string) => s.replace("-", MINUS);

// Rounds away «−0,00 €»: anything that prints as zero is zero.
function clean(n: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) || r === 0 ? 0 : n;
}

export function formatMoney(amount: number | null | undefined): string {
  return trueMinus(currencyFormatter.format(clean(Number(amount ?? 0), 2)));
}

// For table cells: a zero (or nothing) is «—».
export function moneyOrDash(amount: number | null | undefined): string {
  return amount == null || clean(Number(amount), 2) === 0 ? DASH : formatMoney(amount);
}

// «+1.200,00 €» / «−61,53 €» / «0,00 €».
export function formatSignedMoney(amount: number | null | undefined): string {
  const n = clean(Number(amount ?? 0), 2);
  return n > 0 ? `+${formatMoney(n)}` : formatMoney(n);
}

// A plain number in Greek: 1.234,5. `digits` = fixed decimals.
export function formatNumber(n: number | null | undefined, digits = 0, maxDigits = digits): string {
  if (n == null || !Number.isFinite(Number(n))) return DASH;
  return trueMinus(numberFormatter(digits, Math.max(digits, maxDigits)).format(clean(Number(n), maxDigits)));
}

// A ratio (DSCR, LTV multiple): «1,25×».
export function formatMultiple(n: number | null | undefined, digits = 2): string {
  return n == null || !Number.isFinite(Number(n)) ? DASH : `${formatNumber(n, digits)}×`;
}

const PERCENT_LIMIT = 10; // ±1000%

// A rate as a percentage: 0.171 -> «17,1%». `signed` adds «+» to positives.
// Over ±1000% (or not a number) it is «—».
export function formatPercent(
  rate: number | null | undefined,
  { digits = 1, signed = false, fixed = false }: { digits?: number; signed?: boolean; fixed?: boolean } = {},
): string {
  if (rate == null) return formatPercentRaw(0, digits, signed, fixed);
  const r = Number(rate);
  if (!Number.isFinite(r) || Math.abs(r) > PERCENT_LIMIT) return DASH;
  return formatPercentRaw(r, digits, signed, fixed);
}

function formatPercentRaw(r: number, digits: number, signed: boolean, fixed: boolean): string {
  const v = clean(r * 100, digits);
  const body = formatNumber(v, fixed ? digits : 0, digits);
  return `${signed && v > 0 ? "+" : ""}${body}%`;
}

// A value already in percent points (12.5 -> «12,5%»).
export function formatPercentPoints(
  points: number | null | undefined,
  opts: { digits?: number; signed?: boolean; fixed?: boolean } = {},
): string {
  return points == null ? DASH : formatPercent(Number(points) / 100, opts);
}

// A duration from milliseconds: «850 ms», «8,3 δευτ.», «2 λεπ. 5 δευτ.».
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(Number(ms))) return DASH;
  const n = Number(ms);
  if (n < 1000) return `${formatNumber(n)} ms`;
  if (n < 60_000) return `${formatNumber(n / 1000, 1)} δευτ.`;
  const min = Math.floor(n / 60_000);
  const sec = Math.round((n % 60_000) / 1000);
  return sec ? `${min} λεπ. ${sec} δευτ.` : `${min} λεπ.`;
}

// A file size: «512 KB», «1,2 MB».
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${formatNumber(Math.round(bytes / 1024))} KB` : `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return isoDayFormatter.format(new Date(`${date}T00:00:00Z`));
  return dateFormatter.format(typeof date === "string" ? new Date(date) : date);
}

// How long a formatted figure is, for the big-number sizes (ui/Stat): 1 up
// to 11 characters («12.400,00 €»), 2 up to 13, 3 longer.
export function figureLength(value: string): 1 | 2 | 3 {
  return value.length <= 11 ? 1 : value.length <= 13 ? 2 : 3;
}

// A compact figure in Greek units, for chart ticks and one-line summaries:
// 12.400 -> «12 κ.», 1.250.000 -> «1,3 εκ.», 850 -> «850». True minus.
export function formatCompactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return DASH;
  const v = Number(n);
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  if (a >= 999_950) return `${sign}${formatNumber(a / 1_000_000, 0, 1)} εκ.`;
  if (a >= 999.5) return `${sign}${formatNumber(Math.round(a / 1000))} κ.`;
  const body = formatNumber(a, 0, 1);
  return body === "0" ? "0" : `${sign}${body}`;
}

// The same with the euro sign: «−1,2 εκ. €», «340 κ. €», «85 €».
export function formatCompactMoney(n: number | null | undefined): string {
  return n == null || !Number.isFinite(Number(n)) ? DASH : `${formatCompactNumber(n)} €`;
}
