import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { aiEnabled, logAiUsage } from "@/lib/ai/client";
import { phraseInsight } from "@/lib/ai/insights";
import { formatMoney, formatDate } from "@/lib/format";

const SYSTEM_PROMPT = `Είστε οικονομικός βοηθός back office μιας ελληνικής επιχείρησης ακινήτων/κατασκευών. Σας δίνονται ήδη υπολογισμένα γεγονότα (bullet points) για ένα συγκεκριμένο έργο. Γράψτε 2-3 σύντομες προτάσεις στα Ελληνικά που αξιολογούν την πορεία του έργου (budget vs πραγματικά, ρίσκα) -- ΜΗΝ προσθέσετε αριθμούς που δεν σας δόθηκαν, ΜΗΝ κάνετε υπολογισμούς. Αν ο προϋπολογισμός πλησιάζει εξάντληση ή υπάρχουν πολλές εκκρεμείς κινήσεις, επισημάνετέ το ευθέως.`;

export async function POST(req: NextRequest) {
  if (!aiEnabled()) {
    return NextResponse.json({ error: "Ο βοηθός AI δεν είναι ενεργοποιημένος." }, { status: 503 });
  }

  const { project_id } = await req.json();
  if (!project_id) return NextResponse.json({ error: "Λείπει project_id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });
  const orgId = await getCurrentOrgId(supabase);

  const [{ data: rollup }, { data: pending }, { data: lastTx }] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("project_id", project_id).maybeSingle(),
    supabase
      .from("transactions")
      .select("gross_amount")
      .eq("project_id", project_id)
      .eq("status", "pending"),
    supabase
      .from("transactions")
      .select("tx_date")
      .eq("project_id", project_id)
      .order("tx_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!rollup) return NextResponse.json({ error: "Το έργο δεν βρέθηκε." }, { status: 404 });

  const pendingTotal = (pending ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const budget = Number(rollup.total_budget ?? 0);
  const spent = Number(rollup.spent ?? 0);
  const pctSpent = budget > 0 ? Math.round((spent / budget) * 100) : null;

  const facts: string[] = [
    `Προϋπολογισμός: ${formatMoney(budget)}.`,
    `Δαπανηθέντα μέχρι σήμερα: ${formatMoney(spent)}${pctSpent != null ? ` (${pctSpent}% του προϋπολογισμού)` : ""}.`,
    `Υπόλοιπο προϋπολογισμού: ${formatMoney(rollup.remaining_budget)}.`,
    `Εκκρεμείς κινήσεις: ${(pending ?? []).length}, συνολικού ύψους ${formatMoney(pendingTotal)}.`,
    `Έσοδα που έχουν εισπραχθεί: ${formatMoney(rollup.income_received)}.`,
  ];
  if (lastTx?.tx_date) {
    facts.push(`Τελευταία κίνηση στο έργο: ${formatDate(lastTx.tx_date)}.`);
  } else {
    facts.push("Δεν υπάρχει καμία κίνηση ακόμα σε αυτό το έργο.");
  }

  const { text, usage } = await phraseInsight(SYSTEM_PROMPT, facts);

  await logAiUsage(supabase, {
    orgId,
    userId: session.user.id,
    feature: "project_health",
    model: "claude-haiku-4-5",
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    requestId: usage.requestId,
  });

  return NextResponse.json({ text });
}
