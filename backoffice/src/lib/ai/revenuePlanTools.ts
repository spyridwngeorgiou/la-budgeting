import "server-only";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { computeRevenuePlan } from "@/lib/finance/revenuePlan";
import type { ChatToolContext } from "./chatContext";

// create_revenue_plan PROPOSES a new revenue analysis: it is stored as an
// agent_changes action (0083) and created by apply_agent_change() only
// after the user approves it -- the model never writes directly. The
// numbers are still 100% deterministic (computeRevenuePlan, ported from the
// workbook's formulas): the model only supplies occupancy%/ADR
// assumptions, never the revenue math.

const inputSchema = z.object({
  name: z.string().min(1).max(200).describe("π.χ. 'Εκτίμηση Εσόδων Ξενοδοχείου Γλυφάδα'"),
  start_year: z.number().int().min(2000).max(2100).describe("Ημερολογιακό έτος του 'Έτους 1'"),
  room_types: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        unit_count: z.number().int().positive().max(10000),
        assumptions: z
          .array(
            z.object({
              year_number: z.number().int().min(1).max(10),
              month_number: z.number().int().min(1).max(12),
              occupancy_pct: z.number().min(0).max(1),
              adr: z.number().min(0).max(1_000_000),
            }),
          )
          .max(120)
          .describe("Ένα στοιχείο ανά (έτος, μήνας) -- συνήθως 12 x αριθμός ετών"),
      }),
    )
    .min(1)
    .max(30),
});

export type RevenuePlanParams = z.infer<typeof inputSchema> & { years: number };

export function buildRevenuePlanTools(ctx: ChatToolContext) {
  const create_revenue_plan = betaZodTool({
    name: "create_revenue_plan",
    description:
      "Προτείνει μια νέα ανάλυση εκτίμησης εσόδων (π.χ. για ξενοδοχείο/φιλοξενία): τύποι δωματίων x έτη x μήνες, με πληρότητα% και ADR ως τα μόνα inputs -- διανυκτερεύσεις/έσοδα υπολογίζονται αυτόματα, ποτέ από εσάς. Η ανάλυση δημιουργείται ΜΟΝΟ αφού την εγκρίνει ο χρήστης. Αν ο χρήστης δώσει ασαφή στοιχεία (π.χ. 'σταθερή πληρότητα 60% όλο τον χρόνο'), συμπληρώστε λογικά το πλέγμα 12 μηνών και πείτε καθαρά τι υποθέσατε. Αν λείπουν βασικά στοιχεία (αριθμός δωματίων, τιμή), ρωτήστε πριν καλέσετε το εργαλείο.",
    inputSchema,
    run: async ({ name, start_year, room_types }) => {
      const years = Math.max(1, ...room_types.flatMap((r) => r.assumptions.map((a) => a.year_number)));
      // Never trust the model to have summed the grid: compute it here.
      const result = computeRevenuePlan(
        start_year,
        room_types.map((rt, i) => ({ id: `local-${i}`, name: rt.name, unitCount: rt.unit_count })),
        room_types.flatMap((rt, i) =>
          rt.assumptions.map((a) => ({
            roomTypeId: `local-${i}`,
            ...a,
            occupancyPct: a.occupancy_pct,
            yearNumber: a.year_number,
            monthNumber: a.month_number,
          })),
        ),
      );
      const params: RevenuePlanParams = { name, start_year, years, room_types };
      const { data, error } = await ctx.supabase
        .from("agent_changes")
        .insert({
          org_id: ctx.orgId,
          table_name: "revenue_plans",
          row_id: null,
          operation: "action",
          action: "create_revenue_plan",
          before: null,
          // What the reviewer sees on the approval card.
          after: {
            name,
            start_year,
            years,
            room_types: room_types.map((r) => `${r.name} × ${r.unit_count}`).join(", "),
            grand_total_revenue: result.grandTotal,
          },
          params,
          reason: `Νέα εκτίμηση εσόδων «${name}»`,
          requested_by: ctx.userId,
          conversation_id: ctx.conversationId,
          untrusted_context: ctx.untrustedSeen,
        })
        .select("id")
        .single();
      if (error) return JSON.stringify({ error: error.message });
      ctx.changeIds.push(data.id);
      return JSON.stringify({
        change_id: data.id,
        status: "pending",
        message: "Η ανάλυση προτάθηκε και περιμένει έγκριση από τον χρήστη -- δεν έχει δημιουργηθεί ακόμα.",
        grand_total_revenue: result.grandTotal,
        by_year: result.yearTotals.map((y) => ({ year_number: y.yearNumber, revenue: y.annualRevenue })),
      });
    },
  });

  return [create_revenue_plan];
}
