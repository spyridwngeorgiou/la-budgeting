import "server-only";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRevenuePlan } from "@/lib/finance/revenuePlan";

// Unlike propose_change (writeTools.ts), this creates a brand-new, freestanding
// analysis rather than mutating real financial/master data -- lower blast
// radius (nothing existing is touched, and the plan is fully editable/
// deletable afterward from its own page), so it writes directly instead of
// going through the agent_changes approval queue. The numbers behind it are
// still 100% deterministic (computeRevenuePlan, ported from the workbook's
// own formulas) -- the model only supplies occupancy%/ADR assumptions, never
// the revenue math.
export function buildRevenuePlanTools(supabase: SupabaseClient, orgId: string, userId: string | null) {
  const collectedRevenuePlanIds = new Set<string>();

  const create_revenue_plan = betaZodTool({
    name: "create_revenue_plan",
    description:
      "Δημιουργεί μια νέα ανάλυση εκτίμησης εσόδων (π.χ. για ξενοδοχείο/φιλοξενία): τύποι δωματίων x έτη x μήνες, με πληρότητα% και ADR ως τα μόνα inputs -- διανυκτερεύσεις/έσοδα υπολογίζονται αυτόματα, ποτέ από εσάς. Αν ο χρήστης δώσει ασαφή στοιχεία (π.χ. 'σταθερή πληρότητα 60% όλο τον χρόνο'), συμπληρώστε λογικά το πλέγμα 12 μηνών και πείτε καθαρά τι υποθέσατε. Αν λείπουν βασικά στοιχεία (αριθμός δωματίων, τιμή), ρωτήστε πριν καλέσετε το εργαλείο.",
    inputSchema: z.object({
      name: z.string().min(1).describe("π.χ. 'Εκτίμηση Εσόδων Ξενοδοχείου Γλυφάδα'"),
      start_year: z.number().int().min(2000).max(2100).describe("Ημερολογιακό έτος του 'Έτους 1'"),
      room_types: z
        .array(
          z.object({
            name: z.string().min(1),
            unit_count: z.number().int().positive(),
            assumptions: z
              .array(
                z.object({
                  year_number: z.number().int().min(1),
                  month_number: z.number().int().min(1).max(12),
                  occupancy_pct: z.number().min(0).max(1),
                  adr: z.number().min(0),
                }),
              )
              .describe("Ένα στοιχείο ανά (έτος, μήνας) -- συνήθως 12 x αριθμός ετών"),
          }),
        )
        .min(1),
    }),
    run: async ({ name, start_year, room_types }) => {
      const { data: plan, error: planError } = await supabase
        .from("revenue_plans")
        .insert({ org_id: orgId, name, start_year, years: Math.max(...room_types.flatMap((r) => r.assumptions.map((a) => a.year_number))), created_by: userId })
        .select("id")
        .single();
      if (planError) return JSON.stringify({ error: planError.message });

      for (const rt of room_types) {
        const { data: roomType, error: rtError } = await supabase
          .from("revenue_plan_room_types")
          .insert({ org_id: orgId, revenue_plan_id: plan.id, name: rt.name, unit_count: rt.unit_count })
          .select("id")
          .single();
        if (rtError) return JSON.stringify({ error: rtError.message });

        if (rt.assumptions.length > 0) {
          const { error: aError } = await supabase.from("revenue_plan_assumptions").insert(
            rt.assumptions.map((a) => ({
              org_id: orgId,
              room_type_id: roomType.id,
              year_number: a.year_number,
              month_number: a.month_number,
              occupancy_pct: a.occupancy_pct,
              adr: a.adr,
            })),
          );
          if (aError) return JSON.stringify({ error: aError.message });
        }
      }

      // Report back the actual computed grand total (never trust the model
      // to have summed 216 cells correctly) so its reply to the user is
      // guaranteed accurate.
      const roomTypesForCalc = room_types.map((rt, i) => ({ id: `local-${i}`, name: rt.name, unitCount: rt.unit_count }));
      const assumptionsForCalc = room_types.flatMap((rt, i) =>
        rt.assumptions.map((a) => ({ roomTypeId: `local-${i}`, ...a, occupancyPct: a.occupancy_pct, yearNumber: a.year_number, monthNumber: a.month_number })),
      );
      const result = computeRevenuePlan(start_year, roomTypesForCalc, assumptionsForCalc);

      collectedRevenuePlanIds.add(plan.id);
      return JSON.stringify({
        revenue_plan_id: plan.id,
        grand_total_revenue: result.grandTotal,
        by_year: result.yearTotals.map((y) => ({ year_number: y.yearNumber, revenue: y.annualRevenue })),
      });
    },
  });

  return { tools: [create_revenue_plan], collectedRevenuePlanIds };
}
