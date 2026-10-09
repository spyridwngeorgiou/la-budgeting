"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { Button, Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { bulkAssignRows, setRowAssignment } from "../actions";

// Document rows (AADE, AI capture) carry their own project / category /
// account. The pick-lists are sent once for the page through this context,
// not once per row.

export interface Option {
  id: string;
  label: string;
}
export interface ReviewLookups {
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
}

interface ReviewContextValue {
  batchId: string;
  editable: boolean;
  lookups: ReviewLookups;
}

const ReviewCtx = createContext<ReviewContextValue | null>(null);

export function ReviewProvider({ children, ...value }: ReviewContextValue & { children: ReactNode }) {
  return <ReviewCtx.Provider value={value}>{children}</ReviewCtx.Provider>;
}

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewCtx);
  if (!value) throw new Error("ReviewProvider missing");
  return value;
}

const FIELD_OPTIONS = { project_id: "projects", category_id: "categories", account_id: "accounts" } as const;
const FIELD_LABEL = {
  project_id: el.ingest.review.project,
  category_id: el.ingest.review.category,
  account_id: el.ingest.review.account,
} as const;

// One select per field, saved on change (like the old AADE ReviewTable).
export function AssignSelect({
  rowId,
  field,
  value,
}: {
  rowId: string;
  field: keyof typeof FIELD_OPTIONS;
  value: string | null;
}) {
  const { batchId, editable, lookups } = useReview();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = lookups[FIELD_OPTIONS[field]];
  if (!editable) {
    return <span className="text-xs">{options.find((o) => o.id === value)?.label ?? "—"}</span>;
  }
  return (
    <>
      <Select
        aria-label={FIELD_LABEL[field]}
        defaultValue={value ?? ""}
        disabled={pending}
        className={`w-full !py-1 text-xs ${!value && field !== "category_id" ? "border-amber-ink/70" : ""}`}
        onChange={(e) => {
          const next = e.target.value;
          setError(null);
          startTransition(async () => {
            const result = await setRowAssignment(batchId, rowId, field, next);
            if ("error" in result) setError(result.error);
          });
        }}
      >
        <option value="">{FIELD_LABEL[field]} —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-red-ink">{error}</span>}
    </>
  );
}

export const BULK_FORM_ID = "inbox-bulk-assign";

// Row checkboxes live in the server-rendered table and join this form
// through form={BULK_FORM_ID}; no client state is shared with the table.
export function RowCheckbox({ rowId }: { rowId: string }) {
  const { editable } = useReview();
  if (!editable) return null;
  return <input type="checkbox" name="row_ids" value={rowId} form={BULK_FORM_ID} aria-label={el.ingest.review.selected} />;
}

export function BulkAssignBar() {
  const { batchId, editable, lookups } = useReview();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!editable) return null;
  return (
    <form
      id={BULK_FORM_ID}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg p-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        setError(null);
        startTransition(async () => {
          const result = await bulkAssignRows(batchId, formData);
          if ("error" in result) setError(result.error);
          else form.querySelectorAll("select").forEach((s) => (s.value = ""));
        });
      }}
    >
      <span className="text-ink-muted">{el.ingest.review.selected}</span>
      {(Object.keys(FIELD_OPTIONS) as (keyof typeof FIELD_OPTIONS)[]).map((field) => (
        <Select key={field} name={field} defaultValue="" className="!py-1 text-xs">
          <option value="">{FIELD_LABEL[field]} —</option>
          {lookups[FIELD_OPTIONS[field]].map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      <Button type="submit" disabled={pending} className="!px-2 !py-1 text-xs">
        {el.ingest.review.apply}
      </Button>
      {error && <span className="text-xs text-red-ink">{error}</span>}
    </form>
  );
}
