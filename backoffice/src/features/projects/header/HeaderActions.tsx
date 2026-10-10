"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ButtonLink, Button, FormDrawer, MenuItem, MenuLink, MenuSeparator, Menu, useToast } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { projects as t } from "@/lib/i18n/v2/projects";

type Action = (formData: FormData) => Promise<unknown>;

// The header's two visible actions (Επεξεργασία, Κινήσεις έργου) and the
// «⋯» overflow. A drawer opened from the menu lives here, outside the menu,
// because the menu unmounts its items when it closes.
export function HeaderActions({
  projectId,
  canEdit,
  editAction,
  editFields,
  budgetAction,
  budgetFields,
  syncLease,
}: {
  projectId: string;
  canEdit: boolean;
  editAction: Action;
  editFields: ReactNode;
  budgetAction: Action;
  budgetFields: ReactNode;
  syncLease: (() => Promise<unknown>) | null;
}) {
  const [drawer, setDrawer] = useState<"edit" | "budget" | null>(null);
  const [syncing, startSync] = useTransition();
  const { show } = useToast();
  const close = () => setDrawer(null);

  return (
    <>
      {canEdit && (
        <Button variant="secondary" onClick={() => setDrawer("edit")}>
          {t.header.edit}
        </Button>
      )}
      <ButtonLink href={`/transactions?project_id=${projectId}`} variant="primary">
        {t.header.transactions}
      </ButtonLink>
      <Menu>
        {canEdit && <MenuItem onClick={() => setDrawer("budget")}>{t.header.budget}</MenuItem>}
        {canEdit && syncLease && (
          <MenuItem
            disabled={syncing}
            onClick={() =>
              startSync(async () => {
                const error = errorOf(await syncLease());
                show(error ?? t.header.synced, error ? { tone: "negative" } : undefined);
              })
            }
          >
            {t.header.syncLease}
          </MenuItem>
        )}
        {canEdit && <MenuSeparator />}
        <MenuLink href={`/projects/${projectId}/scenarios#compare`}>{t.header.compare}</MenuLink>
        <MenuLink href={`/planner?project=${projectId}`}>{t.header.planner}</MenuLink>
        <MenuLink href={`/collab/${projectId}`}>{t.header.collab}</MenuLink>
        <MenuLink href="/projects/revenue-plans">{t.header.revenuePlans}</MenuLink>
      </Menu>

      {drawer === "edit" && (
        <FormDrawer onClose={close} title={t.header.editTitle} action={editAction}>
          {editFields}
        </FormDrawer>
      )}
      {drawer === "budget" && (
        <FormDrawer onClose={close} title={t.header.budgetTitle} action={budgetAction}>
          {budgetFields}
        </FormDrawer>
      )}
    </>
  );
}
