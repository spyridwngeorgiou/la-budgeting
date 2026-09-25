// The one place Greek VAT/withholding arithmetic is computed. Manual entry,
// the AADE importer, and (phase 4) the AI extraction validator all call this
// -- so "does the assistant's VAT figure match the VAT screen" is true by
// construction, never by coincidence.
//
// All arithmetic happens in integer cents to avoid floating-point drift,
// per the plan's "the model transcribes, the server calculates" principle.

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export interface MoneyBreakdown {
  net: number;
  vat: number;
  vatRate: number;
  withholding: number;
  gross: number;
}

// gross = net + vat - withholding, always in that direction (matches the
// tx_cash_has_no_vat / generated gross_amount rules in the DB schema).
export function deriveFromNet(
  netAmount: number,
  vatRate: number,
  withholding = 0,
): MoneyBreakdown {
  const netCents = toCents(netAmount);
  const vatCents = Math.round(netCents * vatRate);
  const withholdingCents = toCents(withholding);
  return {
    net: fromCents(netCents),
    vat: fromCents(vatCents),
    vatRate,
    withholding: fromCents(withholdingCents),
    gross: fromCents(netCents + vatCents - withholdingCents),
  };
}

// The Greek "quote what you paid" default: given the total someone actually
// handed over, back out net and VAT. Used by natural-language entry, where
// people state gross ("πλήρωσα 250"), not net.
export function deriveFromGross(
  grossAmount: number,
  vatRate: number,
  withholding = 0,
): MoneyBreakdown {
  const grossCents = toCents(grossAmount);
  const withholdingCents = toCents(withholding);
  // gross = net + net*rate - withholding  =>  net = (gross + withholding) / (1 + rate)
  const netCents = Math.round((grossCents + withholdingCents) / (1 + vatRate));
  const vatCents = grossCents + withholdingCents - netCents;
  return {
    net: fromCents(netCents),
    vat: fromCents(vatCents),
    vatRate,
    withholding: fromCents(withholdingCents),
    gross: fromCents(grossCents),
  };
}

// A cash / no-invoice entry carries no VAT and no withholding, matching the
// tx_cash_has_no_vat DB constraint and the workbook's has_invoice toggle.
export function cashOnly(grossAmount: number): MoneyBreakdown {
  return { net: grossAmount, vat: 0, vatRate: 0, withholding: 0, gross: grossAmount };
}

// Carve a partial payment of `paidGross` out of a pending commitment, keeping
// net + vat - withholding = gross exact (to the cent) on BOTH halves. Net and
// withholding scale proportionally; the rounding residue lands on VAT, or on
// net when there is no VAT (cash / no-invoice rows must keep vat = 0).
export function splitProportionally(
  parent: Pick<MoneyBreakdown, "net" | "vat" | "withholding" | "gross">,
  paidGross: number,
): { paid: MoneyBreakdown; remaining: MoneyBreakdown } {
  const parentGross = toCents(parent.gross);
  const paid = toCents(paidGross);
  if (paid <= 0 || paid >= parentGross) {
    throw new Error("Το ποσό πρέπει να είναι θετικό και μικρότερο από το υπόλοιπο της κίνησης.");
  }
  const ratio = paid / parentGross;
  const parentNet = toCents(parent.net);
  const parentVat = toCents(parent.vat);
  const parentWh = toCents(parent.withholding);

  const wh = Math.round(parentWh * ratio);
  let net: number;
  let vat: number;
  if (parentVat === 0) {
    vat = 0;
    net = paid + wh;
  } else {
    net = Math.round(parentNet * ratio);
    vat = paid - net + wh;
  }

  const vatRate = parent.net ? Math.round((parent.vat / parent.net) * 100) / 100 : 0;
  const make = (n: number, v: number, w: number): MoneyBreakdown => ({
    net: fromCents(n), vat: fromCents(v), vatRate, withholding: fromCents(w), gross: fromCents(n + v - w),
  });
  return {
    paid: make(net, vat, wh),
    remaining: make(parentNet - net, parentVat - vat, parentWh - wh),
  };
}

const CENT_TOLERANCE = 0.02;

// The QC identity check (also enforced by v_qc_amount_identity_mismatch).
export function isIdentityConsistent(b: MoneyBreakdown): boolean {
  return Math.abs(b.net + b.vat - b.withholding - b.gross) <= CENT_TOLERANCE;
}

// Greek ΑΦΜ mod-11 checksum. Catches OCR/typing digit errors on the single
// most important key in the system, for free -- no network call needed.
export function isValidAfm(afm: string): boolean {
  if (!/^[0-9]{9}$/.test(afm)) return false;
  const digits = afm.split("").map(Number);
  const checkDigit = digits[8];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += digits[i] * Math.pow(2, 8 - i);
  }
  return (sum % 11) % 10 === checkDigit;
}
