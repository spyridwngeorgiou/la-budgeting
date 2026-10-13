import type { ReactNode } from "react";

// A titled group of form fields (fieldset + legend): «Βασικά»,
// «Αντιστοίχιση», «Παραστατικό και λοιπά» in the movement drawers.
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow w-full border-b border-hairline pb-2 text-muted">{title}</legend>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}
