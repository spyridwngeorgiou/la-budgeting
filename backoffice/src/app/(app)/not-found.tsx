import { ButtonLink, PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Δεν βρέθηκε" />
      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-body text-text">
          Αυτή η σελίδα ή εγγραφή δεν υπάρχει, ή δεν έχετε πρόσβαση σε αυτήν.
        </p>
        <div>
          <ButtonLink href="/dashboard" variant="primary">
            Επιστροφή στον Πίνακα Ελέγχου
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
