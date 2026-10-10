"use server";

import { revalidatePath } from "next/cache";
import * as tx from "@/app/(app)/transactions/actions";
import * as cash from "@/app/(app)/reports/cash/actions";
import * as deals from "@/app/(app)/projects/deals/actions";
import * as accounts from "@/app/(app)/accounts/actions";
import * as contacts from "@/app/(app)/contacts/actions";
import * as vat from "@/app/(app)/reports/vat/actions";
import * as worth from "@/app/(app)/reports/net-worth/actions";

// The «Χρήματα» writes are the legacy pages' own server actions -- every
// rule (money derivation, duplicates, partial payments, closing a deal,
// VAT locks) stays there. These wrappers only add /money to what gets
// revalidated, since the legacy actions refresh their old paths.

async function andRefresh<T>(result: Promise<T>): Promise<T> {
  const r = await result;
  revalidatePath("/money", "layout");
  return r;
}

// Κινήσεις
export async function saveTransaction(id: string | null, formData: FormData) {
  return andRefresh(id ? tx.updateTransaction(id, formData) : tx.createTransaction(formData));
}
export async function markTransactionPaid(id: string) {
  return andRefresh(tx.markPaid(id));
}
export async function payPart(id: string, formData: FormData) {
  return andRefresh(tx.recordPartialPayment(id, formData));
}
export async function removeTransaction(id: string) {
  return andRefresh(tx.deleteTransaction(id));
}

// Ροή: αναμενόμενα έσοδα και μεσιτεία
export async function saveExpected(id: string | null, formData: FormData) {
  return andRefresh(cash.saveExpectedIncome(id, formData));
}
export async function setExpectedStatus(id: string, status: "received" | "cancelled") {
  return andRefresh(cash.setExpectedIncomeStatus(id, status));
}
export async function saveBrokerageDeal(id: string | null, formData: FormData) {
  return andRefresh(deals.saveDeal(id, formData));
}
export async function closeBrokerageDeal(id: string) {
  return andRefresh(deals.closeDeal(id));
}
export async function removeBrokerageDeal(id: string) {
  return andRefresh(deals.deleteDeal(id));
}

// Λογαριασμοί, Επαφές
export async function addAccount(formData: FormData) {
  return andRefresh(accounts.createAccount(formData));
}
export async function checkBalance(accountId: string, formData: FormData) {
  return andRefresh(accounts.assertAccountBalance(accountId, formData));
}
export async function saveContact(id: string | null, formData: FormData) {
  return andRefresh(id ? contacts.updateContact(id, formData) : contacts.createContact(formData));
}

// Αναφορές
export async function toggleVatFiled(periodStart: string, filed: boolean) {
  return andRefresh(vat.toggleVatFiled(periodStart, filed));
}
export async function saveAsset(id: string | null, formData: FormData) {
  return andRefresh(worth.saveAsset(id, formData));
}
export async function removeAsset(id: string) {
  return andRefresh(worth.deleteAsset(id));
}
export async function saveLiability(id: string | null, formData: FormData) {
  return andRefresh(worth.saveLiability(id, formData));
}
export async function removeLiability(id: string) {
  return andRefresh(worth.deleteLiability(id));
}
