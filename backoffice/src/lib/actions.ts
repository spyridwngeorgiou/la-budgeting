import { unstable_rethrow } from "next/navigation";

// Server actions return their user-facing failures instead of throwing them:
// in production Next replaces a thrown error's message with a generic digest,
// so «Μη έγκυρο ΑΦΜ» would reach the user as "An error occurred".
//
//   export async function saveThing(formData: FormData): Promise<ActionResult> {
//     return action(async () => {
//       if (!valid) throw new UserError("Μη έγκυρο ΑΦΜ.");
//       const { error } = await supabase.from("things").insert(row);
//       if (error) throw error; // mapped to Greek by pgErrorToGreek
//       revalidatePath("/things");
//     });
//   }
//
// redirect() and notFound() still work inside: they are rethrown untouched.

export type ActionResult<T = void> = { ok: true; data?: T } | { error: string };

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function ok<T>(data?: T): ActionResult<T> {
  return data === undefined ? { ok: true } : { ok: true, data };
}

export function fail(message: string): { error: string } {
  return { error: message };
}

export function isFailure<T>(result: ActionResult<T> | null | undefined | void): result is { error: string } {
  return !!result && typeof result === "object" && "error" in result && typeof result.error === "string";
}

// The { error } message of any action result, or null. For callers that
// accept both converted (ActionResult) and plain void actions.
export function errorOf(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const e = (result as { error: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return null;
}

const GENERIC = "Η ενέργεια απέτυχε. Δοκιμάστε ξανά.";

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string | null;
}

function isPgLike(e: unknown): e is PgLikeError {
  return !!e && typeof e === "object" && typeof (e as PgLikeError).code === "string";
}

// Postgres/PostgREST error codes a user can actually cause, in Greek.
export function pgErrorToGreek(e: unknown): string {
  if (!isPgLike(e)) return GENERIC;
  switch (e.code) {
    case "23505":
      return "Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία.";
    case "23503":
      return "Η εγγραφή συνδέεται με άλλα στοιχεία (ή αναφέρεται σε κάτι που δεν υπάρχει).";
    case "23514":
      return "Οι τιμές δεν είναι αποδεκτές (αποτυχία ελέγχου εγκυρότητας).";
    case "23502":
      return "Λείπει υποχρεωτικό πεδίο.";
    case "22P02":
    case "22007":
    case "22008":
      return "Μη έγκυρη τιμή σε κάποιο πεδίο.";
    case "42501":
      return "Δεν έχετε δικαίωμα για αυτή την ενέργεια.";
    case "PGRST116":
      return "Η εγγραφή δεν βρέθηκε ή δεν έχετε πρόσβαση.";
    case "P0001":
      // raise exception from our own triggers/functions: written for users.
      return e.message || GENERIC;
    default:
      return GENERIC;
  }
}

export async function action<T>(fn: () => Promise<T | ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const result = await fn();
    if (result && typeof result === "object" && ("error" in result || "ok" in result)) {
      return result as ActionResult<T>;
    }
    return ok(result as T);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return fail(e.message);
    console.error("[action]", e);
    return fail(pgErrorToGreek(e));
  }
}
