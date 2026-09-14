const currencyFormatter = new Intl.NumberFormat("el-GR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const percentFormatter = new Intl.NumberFormat("el-GR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatMoney(amount: number | null | undefined): string {
  return currencyFormatter.format(amount ?? 0);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return dateFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatPercent(rate: number | null | undefined): string {
  return percentFormatter.format(rate ?? 0);
}
