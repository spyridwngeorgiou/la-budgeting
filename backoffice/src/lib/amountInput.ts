import { parseGreekNumber } from "@/lib/ingest/text";

// What a person types in a MoneyInput (a text field with the decimal
// keypad): «1.234,56», «12,5», «1234.56», «-80». Read the Greek way, as
// parseGreekNumber does: a comma is the decimal mark and «1.234» is one
// thousand, while «12.5» / «1234.56» still read as decimals. Null for a
// blank field or anything that is not an amount in cents («12,345», «abc»),
// so a typo is an error the form shows, never a silently different figure.
export function parseAmountInput(raw: FormDataEntryValue | string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const n = parseGreekNumber(raw);
  if (n === null) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

// A stored amount as the field's starting text: 1234.5 -> «1234,5» (no
// thousands dots, so it reads back as the same number).
export function amountInputValue(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}
