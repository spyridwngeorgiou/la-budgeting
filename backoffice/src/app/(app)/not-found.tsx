import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-start justify-center py-16">
      <div className="flex w-full max-w-md flex-col gap-3">
        <h1 className="border-b border-rule pb-3 text-title font-normal text-ink">Δεν βρέθηκε</h1>
        <p className="text-sm text-text">
          Αυτή η σελίδα ή εγγραφή δεν υπάρχει, ή δεν έχετε πρόσβαση σε αυτήν.
        </p>
        <div className="mt-2">
          <ButtonLink href="/dashboard" variant="primary">
            Επιστροφή στον Πίνακα Ελέγχου
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
