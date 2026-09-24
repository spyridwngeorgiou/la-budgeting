import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { aiEnabled, assertWithinAiBudget, logAiUsage } from "@/lib/ai/client";
import { phraseInsight } from "@/lib/ai/insights";
import { formatMoney } from "@/lib/format";

const SYSTEM_PROMPT = `Είστε οικονομικός βοηθός back office μιας ελληνικής επιχείρησης ακινήτων/κατασκευών. Σας δίνονται ήδη υπολογισμένα γεγονότα (bullet points) για την τρέχουσα οικονομική κατάσταση. Γράψτε 2-3 σύντομες προτάσεις στα Ελληνικά που συνοψίζουν τι ξεχωρίζει -- ΜΗΝ προσθέσετε αριθμούς που δεν σας δόθηκαν, ΜΗΝ κάνετε υπολογισμούς, μόνο διατυπώστε τα γεγονότα σε φυσική γλώσσα. Αν κάτι δείχνει ρίσκο (π.χ. μεγάλη αύξηση εξόδων, χαμηλή ρευστότητα), αναφέρετέ το ευθέως αλλά χωρίς δραματοποίηση.`;

export async function POST() {
  if (!aiEnabled()) {
    return NextResponse.json({ error: "Ο βοηθός AI δεν είναι ενεργοποιημένος." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });
  const orgId = await getCurrentOrgId(supabase);
  try {
    await assertWithinAiBudget(supabase, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Το όριο δαπάνης AI έχει εξαντληθεί.";
    return NextResponse.json({ error: message }, { status: 429 });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const thisMonthKey = todayIso.slice(0, 7);
  const d = new Date(todayIso);
  const lastMonthKey = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 7);

  const [{ data: accounts }, { data: projects }, { data: vat }, { data: thisMonthTx }, { data: lastMonthTx }, { data: pending }] =
    await Promise.all([
      supabase.from("v_account_balances").select("current_balance"),
      supabase.from("v_project_rollup").select("display_name, spent, remaining_budget").order("spent", { ascending: false }).limit(1),
      supabase.from("v_vat_position").select("*").lte("period_start", todayIso).order("period_start", { ascending: false }).limit(1),
      supabase.from("transactions").select("gross_amount").eq("direction", "expense").eq("month_key", thisMonthKey).neq("status", "cancelled"),
      supabase.from("transactions").select("gross_amount").eq("direction", "expense").eq("month_key", lastMonthKey).neq("status", "cancelled"),
      supabase.from("transactions").select("gross_amount").eq("status", "pending"),
    ]);

  const liquidTotal = (accounts ?? []).reduce((s, a) => s + Number(a.current_balance ?? 0), 0);
  const topProject = projects?.[0];
  const currentVat = vat?.[0];
  const thisMonthSpend = (thisMonthTx ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const lastMonthSpend = (lastMonthTx ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const pendingTotal = (pending ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const pendingCount = (pending ?? []).length;

  const facts: string[] = [`Συνολική ρευστότητα σε λογαριασμούς: ${formatMoney(liquidTotal)}.`];
  if (topProject) {
    facts.push(
      `Το έργο με τα περισσότερα δαπανηθέντα είναι "${topProject.display_name}": ${formatMoney(topProject.spent)} δαπανηθέντα, ${formatMoney(topProject.remaining_budget)} υπόλοιπο προϋπολογισμού.`,
    );
  }
  if (currentVat) {
    facts.push(`Πληρωτέο ΦΠΑ τρέχουσας περιόδου: ${formatMoney(currentVat.payable_after_credit)}.`);
  }
  if (lastMonthSpend > 0) {
    const deltaPct = Math.round(((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100);
    facts.push(
      `Έξοδα τρέχοντος μήνα: ${formatMoney(thisMonthSpend)}, προηγούμενου μήνα: ${formatMoney(lastMonthSpend)} (μεταβολή ${deltaPct > 0 ? "+" : ""}${deltaPct}%).`,
    );
  } else {
    facts.push(`Έξοδα τρέχοντος μήνα: ${formatMoney(thisMonthSpend)}.`);
  }
  facts.push(`${pendingCount} εκκρεμείς κινήσεις, συνολικού ύψους ${formatMoney(pendingTotal)}.`);

  const startedAt = Date.now();
  const { text, usage } = await phraseInsight(SYSTEM_PROMPT, facts);
  const latencyMs = Date.now() - startedAt;

  await logAiUsage(supabase, {
    orgId,
    userId: session.user.id,
    feature: "dashboard_summary",
    model: "claude-haiku-4-5",
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    latencyMs,
    requestId: usage.requestId,
  });

  return NextResponse.json({ text });
}
