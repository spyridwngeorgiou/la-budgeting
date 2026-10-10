"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { isIsoDate } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { ASSET_STATE, LIABILITY_KIND, LIABILITY_STATE, type AssetState, type LiabilityKind, type LiabilityState } from "@/lib/domain/enums";

// Assets and liabilities (0008): the hand-kept half of the net worth. Every
// total on the page is v_net_worth (0068); these only write the rows.

function revalidate() {
  revalidatePath("/reports/net-worth");
  revalidatePath("/reports/cash");
  revalidatePath("/dashboard");
}

function money(formData: FormData, name: string): number {
  const n = Number(formData.get(name));
  if (!Number.isFinite(n) || n < 0) throw new UserError(el.netWorth.invalidAmount);
  return n;
}

function pct(formData: FormData, name: string, fallback: number): number {
  const raw = formString(formData, name);
  const n = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new UserError(el.netWorth.invalidPct);
  return n / 100;
}

function date(formData: FormData, name: string): string | null {
  const v = formString(formData, name);
  if (v && !isIsoDate(v)) throw new UserError(el.netWorth.invalidDate);
  return v;
}

function ownerScope(formData: FormData) {
  return formString(formData, "owner_scope") === "corporate" ? ("corporate" as const) : ("personal" as const);
}

function required(formData: FormData, name: string, label: string): string {
  const v = (formString(formData, name) ?? "").trim();
  if (!v) throw new UserError(`${label}: ${el.netWorth.required}`);
  return v;
}

export async function saveAsset(id: string | null, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const t = el.netWorth;
    const state = formString(formData, "state") ?? "held";
    if (!(ASSET_STATE as readonly string[]).includes(state)) throw new UserError(t.assetState);
    const fields = {
      name: required(formData, "name", t.name),
      category: formString(formData, "category"),
      estimated_value: money(formData, "estimated_value"),
      ownership_pct: pct(formData, "ownership_pct", 100),
      owner_scope: ownerScope(formData),
      state: state as AssetState,
      valuation_date: date(formData, "valuation_date"),
      notes: formString(formData, "notes"),
    };
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = id
      ? await supabase.from("assets").update(fields).eq("id", id).eq("org_id", orgId)
      : await supabase.from("assets").insert({ ...fields, org_id: orgId });
    if (error) throw error;
    revalidate();
  });
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase.from("assets").delete().eq("id", id).eq("org_id", orgId);
    if (error) throw error;
    revalidate();
  });
}

export async function saveLiability(id: string | null, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const t = el.netWorth;
    const state = formString(formData, "state") ?? "disbursed";
    if (!(LIABILITY_STATE as readonly string[]).includes(state)) throw new UserError(t.liabilityState);
    const kind = formString(formData, "kind") ?? "private";
    if (!(LIABILITY_KIND as readonly string[]).includes(kind)) throw new UserError(t.liabilityKind);
    const fields = {
      lender: required(formData, "lender", t.lender),
      kind: kind as LiabilityKind,
      principal: money(formData, "principal"),
      interest_rate: pct(formData, "interest_pct", 0),
      maturity_date: date(formData, "maturity_date"),
      state: state as LiabilityState,
      owner_scope: ownerScope(formData),
      terms: formString(formData, "terms"),
    };
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = id
      ? await supabase.from("liabilities").update(fields).eq("id", id).eq("org_id", orgId)
      : await supabase.from("liabilities").insert({ ...fields, org_id: orgId });
    if (error) throw error;
    revalidate();
  });
}

export async function deleteLiability(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase.from("liabilities").delete().eq("id", id).eq("org_id", orgId);
    if (error) throw error;
    revalidate();
  });
}
