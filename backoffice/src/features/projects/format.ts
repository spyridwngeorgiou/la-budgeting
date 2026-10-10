// Figures of the v2 project pages. Amounts keep formatMoney's look; the
// glance panel rounds to whole euros so six figures fit one row.

const euro0 = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("el-GR", { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const money0 = (n: number | null | undefined) => euro0.format(Math.round(Number(n ?? 0)));
export const percent = (rate: number | null | undefined) => (rate == null || !Number.isFinite(rate) ? "—" : pct1.format(rate));
export const times = (n: number | null | undefined) => (n == null ? "—" : `${dec2.format(n)}×`);
