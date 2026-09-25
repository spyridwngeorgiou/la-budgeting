"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formString } from "@/lib/supabase/org";

// Clears the "no invoice" risk once the supplier's παραστατικό arrives. VAT is
// not split here (that needs the real invoice figures -- edit the transaction);
// a cash payment above the threshold stays flagged as cash_over_limit, which
// is correct: it is non-deductible even with an invoice.
export async function markInvoiceReceived(transactionId: string, formData: FormData) {
  const supabase = await createClient();
  const invoiceNumber = formString(formData, "invoice_number");
  const { error } = await supabase
    .from("transactions")
    .update({ has_invoice: true, ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}) })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
  revalidatePath("/quality");
  revalidatePath("/transactions");
}
