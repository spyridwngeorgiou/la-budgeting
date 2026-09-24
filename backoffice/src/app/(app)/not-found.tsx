import Link from "next/link";
import { Card, Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card className="max-w-md text-center">
        <h1 className="text-lg font-semibold">Δεν βρέθηκε</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Αυτή η σελίδα ή εγγραφή δεν υπάρχει, ή δεν έχετε πρόσβαση σε αυτήν.
        </p>
        <Link href="/dashboard">
          <Button className="mt-4">Επιστροφή στον Πίνακα Ελέγχου</Button>
        </Link>
      </Card>
    </div>
  );
}
