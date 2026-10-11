"use client";

import { switchOrg } from "./org-actions";

export function OrgSwitcher({ orgs, currentOrgId }: { orgs: { id: string; name: string }[]; currentOrgId: string }) {
  // Hidden entirely for the common case (exactly one org) -- nothing to
  // switch between, and showing a disabled dropdown would just be noise.
  if (orgs.length < 2) return null;

  return (
    <form action={switchOrg} className="px-4 pb-2">
      <select
        name="org_id"
        defaultValue={currentOrgId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-11 w-full border border-field-border bg-field px-2 py-1.5 text-body text-ink focus:border-navy focus:outline-none md:min-h-9 md:text-small"
      >
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </form>
  );
}
