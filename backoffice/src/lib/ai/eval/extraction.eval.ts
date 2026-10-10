import { describe, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extractionRequest, type ExtractionEffort } from "@/lib/ai/extractRequest";
import { EXTRACTION_EFFORT, EXTRACTION_MODEL } from "@/lib/ai/models";
import type { Extraction } from "@/lib/ai/schemas";
import {
  compareExtractions,
  costUsd,
  estimateCallUsd,
  KEY_FIELDS,
  median,
  normalise,
  pct,
  type FieldAgreement,
  type KeyField,
  type Normalised,
} from "./compare";

// Extraction eval: the pre-migration model (claude-opus-5, no explicit
// effort -- exactly the old request) vs the production model
// (EXTRACTION_MODEL at EXTRACTION_EFFORT) on every image/PDF in
// backoffice/eval-receipts/. Reports per-file and overall agreement on the
// key fields, latency, tokens and cost; writes eval-receipts/report.json.
//
// Paid. Never part of `npm test` (vitest.config.mts includes *.test.ts only).
//   AI_EVAL=1 npx vitest run -c vitest.eval.config.mts            -> estimate only (count_tokens, free)
//   AI_EVAL=1 AI_EVAL_CONFIRM=1 npx vitest run -c vitest.eval.config.mts  -> real run
// Spend is capped at AI_EVAL_CAP_USD (default and maximum $3): the run aborts
// before any call that could push actual + in-flight estimated spend past it.
// ANTHROPIC_API_KEY comes from the environment, else backoffice/.env.local,
// .dev.vars, or the file named by AI_EVAL_ENV_FILE. It is never printed.

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const DIR = path.join(ROOT, "eval-receipts");
const REPORT = path.join(DIR, "report.json");
const HARD_CAP_USD = 3;
const CAP_USD = Math.min(Number(process.env.AI_EVAL_CAP_USD) || HARD_CAP_USD, HARD_CAP_USD);
// Thinking + the JSON; deliberately generous for the pre-run estimate.
const ASSUMED_OUTPUT_TOKENS = 4000;
const CONCURRENCY = 3;
const CATEGORIES = (process.env.AI_EVAL_CATEGORIES ?? "Υλικά,Εργασίες,Ενέργεια,Νερό,Τηλεπικοινωνίες,Καύσιμα,Αμοιβές τρίτων,Ενοίκια,Λοιπά")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MEDIA: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

interface Arm {
  label: "old" | "new";
  model: string;
  effort: ExtractionEffort | null;
}
const ARMS: Arm[] = [
  { label: "old", model: "claude-opus-5", effort: null },
  { label: "new", model: EXTRACTION_MODEL, effort: EXTRACTION_EFFORT },
];

interface CallResult {
  model: string;
  servedModel: string | null;
  effort: ExtractionEffort | null;
  ok: boolean;
  error: string | null;
  stopReason: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  normalised: Normalised | null;
  extraction: Extraction | null;
}

function loadApiKey(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const candidates = [process.env.AI_EVAL_ENV_FILE, path.join(ROOT, ".env.local"), path.join(ROOT, ".dev.vars")];
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    const match = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(readFileSync(file, "utf8"));
    const value = match?.[1].trim().replace(/^["']|["']$/g, "");
    if (value) {
      process.env.ANTHROPIC_API_KEY = value;
      console.log(`[eval] ANTHROPIC_API_KEY loaded from ${path.basename(file)} (value not shown)`);
      return true;
    }
  }
  return false;
}

function inputs(): { file: string; mediaType: string; base64: string }[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => MEDIA[path.extname(f).toLowerCase()])
    .sort()
    .map((file) => ({
      file,
      mediaType: MEDIA[path.extname(file).toLowerCase()],
      base64: readFileSync(path.join(DIR, file)).toString("base64"),
    }));
}

const usd = (n: number) => `$${n.toFixed(4)}`;

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

describe.skipIf(process.env.AI_EVAL !== "1")("extraction eval: claude-opus-5 vs EXTRACTION_MODEL", () => {
  it("compares key fields on eval-receipts/*", { timeout: 60 * 60 * 1000 }, async () => {
    const docs = inputs();
    if (docs.length === 0) {
      console.log(`[eval] no images/PDFs in ${DIR} -- nothing to do (see eval-receipts/README.md)`);
      return;
    }
    if (!loadApiKey()) {
      console.log("[eval] no ANTHROPIC_API_KEY in the environment, .env.local or .dev.vars -- skipping");
      return;
    }
    const client = new Anthropic({ maxRetries: 2, timeout: 300_000 });

    // ---- 1. estimate (count_tokens is free) --------------------------------
    const estimates = new Map<string, number>(); // `${file}|${model}` -> usd
    let estimateTotal = 0;
    for (const doc of docs) {
      for (const arm of ARMS) {
        const req = extractionRequest({
          base64Data: doc.base64,
          mediaType: doc.mediaType,
          categoryNames: CATEGORIES,
          model: arm.model,
          effort: arm.effort,
        });
        let inputTokens: number;
        try {
          const counted = await client.messages.countTokens({ model: req.model, system: req.system, messages: req.messages });
          // + the output schema the API adds to the prompt (~1K tokens).
          inputTokens = counted.input_tokens + 1000;
        } catch {
          inputTokens = 6000;
        }
        const est = estimateCallUsd(arm.model, inputTokens, ASSUMED_OUTPUT_TOKENS);
        estimates.set(`${doc.file}|${arm.model}`, est);
        estimateTotal += est;
      }
    }
    console.log(
      `[eval] ${docs.length} document(s) x ${ARMS.length} models = ${docs.length * ARMS.length} calls; ` +
        `estimated cost ${usd(estimateTotal)} (assuming ${ASSUMED_OUTPUT_TOKENS} output tokens/call); cap ${usd(CAP_USD)}`,
    );
    if (estimateTotal > CAP_USD) {
      throw new Error(`[eval] estimate ${usd(estimateTotal)} exceeds the ${usd(CAP_USD)} cap -- remove documents and retry`);
    }
    if (process.env.AI_EVAL_CONFIRM !== "1") {
      console.log("[eval] estimate only. Re-run with AI_EVAL_CONFIRM=1 to call the API.");
      return;
    }

    // ---- 2. run, under the cap --------------------------------------------
    let spent = 0;
    let reserved = 0;
    let aborted: string | null = null;
    const results = new Map<string, Partial<Record<Arm["label"], CallResult>>>();

    await pool(docs, CONCURRENCY, async (doc) => {
      const row: Partial<Record<Arm["label"], CallResult>> = {};
      results.set(doc.file, row);
      for (const arm of ARMS) {
        const est = estimates.get(`${doc.file}|${arm.model}`) ?? 0;
        if (aborted || spent + reserved + est > CAP_USD) {
          aborted ??= `cap ${usd(CAP_USD)} would be exceeded (spent ${usd(spent)}, in flight ${usd(reserved)})`;
          return;
        }
        reserved += est;
        const startedAt = Date.now();
        const result: CallResult = {
          model: arm.model,
          servedModel: null,
          effort: arm.effort,
          ok: false,
          error: null,
          stopReason: null,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          normalised: null,
          extraction: null,
        };
        try {
          const response = await client.beta.messages.parse(
            extractionRequest({
              base64Data: doc.base64,
              mediaType: doc.mediaType,
              categoryNames: CATEGORIES,
              model: arm.model,
              effort: arm.effort,
            }),
          );
          result.latencyMs = Date.now() - startedAt;
          result.servedModel = response.model;
          result.stopReason = response.stop_reason;
          result.inputTokens = response.usage.input_tokens;
          result.outputTokens = response.usage.output_tokens;
          result.costUsd = costUsd(response.model || arm.model, {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
          });
          if (response.parsed_output) {
            result.ok = true;
            result.extraction = response.parsed_output;
            result.normalised = normalise(response.parsed_output);
          } else {
            result.error = `no parsed output (stop_reason ${response.stop_reason})`;
          }
        } catch (error) {
          result.latencyMs = Date.now() - startedAt;
          result.error = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : String(error);
        }
        reserved -= est;
        spent += result.costUsd;
        row[arm.label] = result;
      }
    });

    // ---- 3. report -----------------------------------------------------------
    const perFile: {
      file: string;
      agreement: FieldAgreement | null;
      agreed: number;
      differences: Partial<Record<KeyField, { old: string | null; new: string | null }>>;
      old: CallResult | null;
      new: CallResult | null;
    }[] = [];
    const fieldAgree = Object.fromEntries(KEY_FIELDS.map((f) => [f, 0])) as Record<KeyField, number>;
    let compared = 0;
    let fullyAgreeing = 0;

    for (const doc of docs) {
      const row = results.get(doc.file) ?? {};
      const o = row.old ?? null;
      const n = row.new ?? null;
      let agreement: FieldAgreement | null = null;
      const differences: Partial<Record<KeyField, { old: string | null; new: string | null }>> = {};
      if (o?.extraction && n?.extraction) {
        agreement = compareExtractions(o.extraction, n.extraction);
        compared++;
        for (const f of KEY_FIELDS) {
          if (agreement[f]) fieldAgree[f]++;
          else differences[f] = { old: o.normalised?.[f] ?? null, new: n.normalised?.[f] ?? null };
        }
        if (KEY_FIELDS.every((f) => agreement![f])) fullyAgreeing++;
      }
      perFile.push({
        file: doc.file,
        agreement,
        agreed: agreement ? KEY_FIELDS.filter((f) => agreement![f]).length : 0,
        differences,
        old: o,
        new: n,
      });
    }

    console.log("\n[eval] per file");
    console.table(
      perFile.map((r) => ({
        file: r.file,
        agree: r.agreement ? `${r.agreed}/${KEY_FIELDS.length}` : "n/a",
        differs: Object.entries(r.differences)
          .map(([f, d]) => `${f}: ${d?.old ?? "∅"} -> ${d?.new ?? "∅"}`)
          .join("; "),
        "old ms": r.old?.latencyMs ?? "",
        "new ms": r.new?.latencyMs ?? "",
        "old $": r.old ? r.old.costUsd.toFixed(4) : "",
        "new $": r.new ? r.new.costUsd.toFixed(4) : "",
        errors: [r.old?.error && `old: ${r.old.error}`, r.new?.error && `new: ${r.new.error}`].filter(Boolean).join(" | "),
      })),
    );

    const totalFieldAgree = KEY_FIELDS.reduce((s, f) => s + fieldAgree[f], 0);
    const perField = Object.fromEntries(KEY_FIELDS.map((f) => [f, pct(fieldAgree[f], compared)]));
    console.log("\n[eval] agreement by field (documents both models read)");
    console.table(perField);
    console.log(
      `[eval] overall: ${pct(totalFieldAgree, compared * KEY_FIELDS.length)} of fields, ` +
        `${pct(fullyAgreeing, compared)} of documents fully agree (${compared}/${docs.length} compared)`,
    );

    const models = ARMS.map((arm) => {
      const calls = perFile.map((r) => r[arm.label]).filter((c): c is CallResult => !!c);
      const ok = calls.filter((c) => c.ok);
      const cost = calls.reduce((s, c) => s + c.costUsd, 0);
      return {
        label: arm.label,
        model: arm.model,
        effort: arm.effort ?? "(model default)",
        served: [...new Set(calls.map((c) => c.servedModel).filter(Boolean))].join(","),
        calls: calls.length,
        errors: calls.length - ok.length,
        medianLatencyMs: Math.round(median(ok.map((c) => c.latencyMs))),
        meanLatencyMs: ok.length ? Math.round(ok.reduce((s, c) => s + c.latencyMs, 0) / ok.length) : 0,
        inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
        outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
        costUsd: Number(cost.toFixed(4)),
        costPerDocUsd: calls.length ? Number((cost / calls.length).toFixed(4)) : 0,
      };
    });
    console.log("\n[eval] per model");
    console.table(models);
    console.log(`[eval] total spend ${usd(spent)} (estimate was ${usd(estimateTotal)}, cap ${usd(CAP_USD)})`);
    if (aborted) console.log(`[eval] ABORTED early: ${aborted}`);

    writeFileSync(
      REPORT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          arms: ARMS,
          categories: CATEGORIES,
          documents: docs.length,
          compared,
          aborted,
          estimateUsd: estimateTotal,
          spentUsd: spent,
          capUsd: CAP_USD,
          agreement: {
            fields: pct(totalFieldAgree, compared * KEY_FIELDS.length),
            documentsFullyAgreeing: pct(fullyAgreeing, compared),
            byField: perField,
          },
          models,
          perFile,
        },
        null,
        2,
      ),
    );
    console.log(`[eval] report written to ${path.relative(ROOT, REPORT)}`);
    if (aborted) throw new Error(`[eval] aborted: ${aborted}`);
  });
});
