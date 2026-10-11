"use client";

import { useState, useTransition } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { Badge, Button, Select } from "@/components/ui";
import { updateStagingRowField, bulkAssign } from "../actions";
import { specRow, specTable, specTd, specTh } from "@/components/specTable";

interface Option {
  id: string;
  label: string;
}

interface StagingRow {
  id: string;
  row_no: number;
  issue_date: string | null;
  counterparty_name: string | null;
  counterparty_afm: string | null;
  gross_amount: number | null;
  direction: string | null;
  dedup_status: string;
  decision: string;
  project_id: string | null;
  category_id: string | null;
  account_id: string | null;
  matched_transaction_id: string | null;
}

const DEDUP_LABEL: Record<string, string> = {
  new: "Νέα",
  dup_mark: "Διπλότυπο (ΜΑΡΚ)",
  dup_fingerprint: "Διπλότυπο (ήδη καταχωρημένο)",
  dup_self_classification: "Παράλληλη εγγραφή myDATA",
  dup_in_batch: "Διπλότυπο εντός αρχείου",
};

export function ReviewTable({
  batchId,
  rows,
  projects,
  categories,
  accounts,
}: {
  batchId: string;
  rows: StagingRow[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProject, setBulkProject] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkAccount, setBulkAccount] = useState("");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [, startTransition] = useTransition();

  const visibleRows = rows.filter((r) => showDuplicates || r.dedup_status === "new");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyBulk() {
    const fields: Record<string, string> = {};
    if (bulkProject) fields.project_id = bulkProject;
    if (bulkCategory) fields.category_id = bulkCategory;
    if (bulkAccount) fields.account_id = bulkAccount;
    if (Object.keys(fields).length === 0 || selected.size === 0) return;
    startTransition(() => {
      bulkAssign(batchId, [...selected], fields);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-10 items-center gap-2 text-body text-muted">
        <input
          type="checkbox"
          checked={showDuplicates}
          onChange={(e) => setShowDuplicates(e.target.checked)}
        />
        Εμφάνιση διπλότυπων ({rows.length - rows.filter((r) => r.dedup_status === "new").length})
      </label>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-y border-hairline py-2 text-body">
          <span>{selected.size} επιλεγμένες:</span>
          <Select value={bulkProject} onChange={(e) => setBulkProject(e.target.value)}>
            <option value="">Έργο —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
            <option value="">Κατηγορία —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select value={bulkAccount} onChange={(e) => setBulkAccount(e.target.value)}>
            <option value="">Λογαριασμός —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
          <Button onClick={applyBulk} className="!px-2 !py-1 text-small">
            Εφαρμογή
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className={specTable}>
          <thead>
            <tr>
              <th scope="col" className={specTh}></th>
              <th scope="col" className={specTh}>Ημ/νία</th>
              <th scope="col" className={specTh}>Αντισυμβαλλόμενος</th>
              <th scope="col" className={`${specTh} text-right`}>Ποσό</th>
              <th scope="col" className={specTh}>Κατάσταση</th>
              <th scope="col" className={specTh}>Έργο</th>
              <th scope="col" className={specTh}>Κατηγορία</th>
              <th scope="col" className={specTh}>Λογαριασμός</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className={specRow}>
                <td className={specTd}>
                  {row.dedup_status === "new" && (
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                  )}
                </td>
                <td className={`${specTd} num`}>{formatDate(row.issue_date)}</td>
                <td className={`${specTd} text-ink`}>{row.counterparty_name ?? "—"}</td>
                <td
                  className={`${specTd} num text-right text-ink`}
                >
                  {row.direction === "income" ? "+" : row.direction === "expense" ? "−" : ""}
                  {formatMoney(row.gross_amount)}
                </td>
                <td className={specTd}>
                  {row.dedup_status === "new" ? (
                    <Badge tone="green">Νέα</Badge>
                  ) : (
                    <Badge tone="neutral">{DEDUP_LABEL[row.dedup_status] ?? row.dedup_status}</Badge>
                  )}
                </td>
                {row.dedup_status === "new" ? (
                  <>
                    <td className={specTd}>
                      <RowSelect
                        rowId={row.id}
                        field="project_id"
                        value={row.project_id}
                        options={projects}
                      />
                    </td>
                    <td className={specTd}>
                      <RowSelect
                        rowId={row.id}
                        field="category_id"
                        value={row.category_id}
                        options={categories}
                      />
                    </td>
                    <td className={specTd}>
                      <RowSelect
                        rowId={row.id}
                        field="account_id"
                        value={row.account_id}
                        options={accounts}
                      />
                    </td>
                  </>
                ) : (
                  <td className={`${specTd} text-small text-muted`} colSpan={3}>
                    Θα παραλειφθεί
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowSelect({
  rowId,
  field,
  value,
  options,
}: {
  rowId: string;
  field: "project_id" | "category_id" | "account_id";
  value: string | null;
  options: Option[];
}) {
  return (
    <Select
      defaultValue={value ?? ""}
      onChange={(e) => updateStagingRowField(rowId, field, e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
