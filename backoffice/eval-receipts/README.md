# eval-receipts

Inputs for the document-extraction eval (`src/lib/ai/eval/extraction.eval.ts`).

Drop 20–30 real receipts / invoices here: photos (`.jpg`, `.jpeg`, `.png`, `.webp`) or PDFs,
ideally a mix of what the office actually gets (supermarket receipts, ΔΕΗ / water / telecom bills,
supplier invoices with a myDATA MARK, a blurry phone photo or two).

**Never committed.** Everything in this folder except this README is git-ignored, because these are
real financial documents (names, ΑΦΜ, amounts). `report.json` is written here too and is ignored as well.

## Run

From `backoffice/`:

```sh
# 1. Estimate only: counts input tokens (free) and prints the expected cost. No model calls.
AI_EVAL=1 npx vitest run -c vitest.eval.config.mts

# 2. Real run: each document through the old model (claude-opus-5) and the production
#    extraction model (EXTRACTION_MODEL), then compares the key fields.
AI_EVAL=1 AI_EVAL_CONFIRM=1 npx vitest run -c vitest.eval.config.mts
```

PowerShell: `$env:AI_EVAL='1'; $env:AI_EVAL_CONFIRM='1'; npx vitest run -c vitest.eval.config.mts`.

- `ANTHROPIC_API_KEY` is read from the environment, else `backoffice/.env.local`, `.dev.vars`, or the
  file named by `AI_EVAL_ENV_FILE`. It is never printed.
- Spend is capped at `AI_EVAL_CAP_USD` (default and maximum $3). The run aborts if the estimate is over
  the cap, or before any call that would take actual + in-flight spend past it. Roughly $0.03–0.06 per
  document for both models together.
- Compared fields, after normalisation: issuer ΑΦΜ (digits), issue date (ISO), gross / net / VAT amount
  (to the cent), myDATA MARK (digits), document type. Both-null counts as agreement. This measures
  agreement between the models, not accuracy — read the disagreeing documents yourself.
- `AI_EVAL_CATEGORIES` (comma-separated) overrides the category list sent in the prompt.
