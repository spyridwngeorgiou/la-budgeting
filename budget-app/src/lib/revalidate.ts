import { revalidatePath } from "next/cache";

/**
 * Revalidate every app route (whole layout) so that derived totals across all
 * pages (dashboard, projects, accounts, transactions, income) stay consistent
 * after any create/update/delete.
 */
export function revalidateAll() {
  revalidatePath("/", "layout");
}
