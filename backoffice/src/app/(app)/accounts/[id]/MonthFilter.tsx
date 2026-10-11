"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";

// ?month=YYYY-MM on the account page; changing it goes back to page 1.
export function MonthFilter({
  accountId,
  month,
  options,
}: {
  accountId: string;
  month: string | null;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <Select
      aria-label="Μήνας"
      value={month ?? ""}
      onChange={(e) => {
        const m = e.target.value;
        router.push(m ? `/accounts/${accountId}?month=${m}` : `/accounts/${accountId}`);
      }}
      className="w-auto"
    >
      <option value="">{el.account.allMonths}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
