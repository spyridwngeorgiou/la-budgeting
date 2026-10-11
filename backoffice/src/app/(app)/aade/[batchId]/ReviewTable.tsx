"use client";

import { useState, useTransition } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { Button, Select, SpecTable, StatusDot, Td, Th, Tr } from "@/components/ui";
import { updateStagingRowField, bulkAssign } from "../actions";

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
          <Button onClick={applyBulk} size="sm">
            Εφαρμογή
          </Button>
        </div>
      )}

      <SpecTable label="Γραμμές εισαγωγής">
        <thead>
          <tr>
            <Th></Th>
            <Th>Ημ/νία</Th>
            <Th>Αντισυμβαλλόμενος</Th>
            <Th numeric>Ποσό</Th>
            <Th>Κατάσταση</Th>
            <Th>Έργο</Th>
            <Th>Κατηγορία</Th>
            <Th>Λογαριασμός</Th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <Tr key={row.id}>
              <Td>
                {row.dedup_status === "new" && (
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                )}
              </Td>
              <Td className="num">{formatDate(row.issue_date)}</Td>
              <Td strong>{row.counterparty_name ?? "—"}</Td>
              <Td numeric strong>
                {row.direction === "income" ? "+" : row.direction === "expense" ? "−" : ""}
                {formatMoney(row.gross_amount)}
              </Td>
              <Td>
                {row.dedup_status === "new" ? (
                  <StatusDot tone="positive" label="Νέα" />
                ) : (
                  <StatusDot tone="neutral" label={DEDUP_LABEL[row.dedup_status] ?? row.dedup_status} />
                )}
              </Td>
              {row.dedup_status === "new" ? (
                <>
                  <Td>
                    <RowSelect
                      rowId={row.id}
                      field="project_id"
                      value={row.project_id}
                      options={projects}
                    />
                  </Td>
                  <Td>
                    <RowSelect
                      rowId={row.id}
                      field="category_id"
                      value={row.category_id}
                      options={categories}
                    />
                  </Td>
                  <Td>
                    <RowSelect
                      rowId={row.id}
                      field="account_id"
                      value={row.account_id}
                      options={accounts}
                    />
                  </Td>
                </>
              ) : (
                <Td className="text-small text-muted" colSpan={3}>
                  Θα παραλειφθεί
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </SpecTable>
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
