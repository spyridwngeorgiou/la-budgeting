# Back Office

Replaces `Επιχειρησιακό_Αρχείο_107.xlsx` — the hand-kept source of truth for
this business's ledger, projects, contacts, VAT/withholding, budgets and
wealth — with a real multi-user web app, then extends it with AI-assisted
entry (receipt photo, natural language) and a chat assistant over the books.

See `.claude/plans/the-back-office-app-we-should-lovely-tower.md` (or the
project's plan history) for the full design rationale, schema walkthrough,
and phasing.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind 4, on Supabase (Postgres 17,
Auth, Storage). No ORM — the hard parts here (VAT carry-forward, installment
generation, cash forecasts) are SQL-shaped; `supabase gen types typescript`
gives type safety without one.

## Deployment portability — a standing constraint

Vercel's Hobby tier is licensed for **non-commercial use only**; this is a
real business's back office. Either pay for Vercel Pro, or deploy elsewhere.
To keep that decision cheap, **this app avoids every Vercel-only primitive**
— no `@vercel/blob`, no `after()`-dependent logic, no ISR-tag tricks.
Everything server-side goes through Route Handlers / Server Actions and
Supabase, so moving to Cloudflare Workers (via OpenNext) or a plain VPS stays
a config change. Do not introduce a Vercel-only dependency without updating
this note.

## Free-tier limits that actually bite

| Concern | Limit | Mitigation |
| --- | --- | --- |
| Supabase project pausing | paused after 7 idle days | `.github/workflows/keepalive.yml` pings `/api/health` every 3 days |
| Supabase Storage | 1 GB | receipt photos **must** be downscaled client-side to ≤1600px / JPEG q0.8 before upload — this is required, not an optimisation |
| Vercel Hobby licence | non-commercial only | see above |

Database size, Auth MAU and Storage egress are not a concern at this
business's scale.

## Open questions to resolve before go-live

1. **VAT filing regime** — monthly (διπλογραφικά) or quarterly
   (απλογραφικά)? Confirm with the accountant; set
   `orgs.settings->>'vat_period'` accordingly — it drives the period spine
   in `v_vat_position`.
2. **Deployment target** — Vercel Pro ($20/mo) or Cloudflare Workers (free,
   commercial-use permitted)?
3. **`orgs.own_afm`** — the real company ΑΦΜ, needed before any AADE import
   can determine transaction direction (currently a placeholder).

## Ingest cutover (`INGEST_UNIFIED`, plan Φάση 7)

AADE files, AI photo/text/voice captures and inbound email all stage into
`ingest_batches`/`ingest_rows` and are reviewed in `/inbox/[batchId]` once
`INGEST_UNIFIED` is `"true"` (wrangler.jsonc `vars`, per environment; it is
`"false"` in both until this checklist is done). Migrations 0072/0073 copy
the old `transaction_drafts` and `aade_*` history in (`legacy_ref`,
`meta.legacy = true`, never undoable); 0074 keeps a read-only view of it.
Nothing old is dropped before Phase 8 (0077).

Per environment, staging first, then production:

1. **Backup** (production): JSON export of the database.
2. **Migrate**: `node scripts/migrate-remote.mjs <ref> --dry-run`, then
   without `--dry-run`. 0072/0073 run the backfill as part of the migration.
3. **Check the backfill** (SQL editor) -- every query should return 0:

   ```sql
   -- drafts / AADE imports without a copy
   select count(*) from transaction_drafts d where not exists
     (select 1 from ingest_batches b where b.org_id = d.org_id and b.legacy_ref = 'draft:' || d.id);
   select count(*) from aade_import_batches a where not exists
     (select 1 from ingest_batches b where b.org_id = a.org_id and b.legacy_ref = 'aade:' || a.id);
   -- AADE rows: the copy has every row
   select count(*) from aade_staging_rows s where not exists
     (select 1 from ingest_rows r where r.meta->>'aade_staging_row_id' = s.id::text);
   -- ledger links
   select count(*) from transactions where aade_staging_row_id is not null and ingest_row_id is null;
   select count(*) from transaction_drafts d join transactions t on t.id = d.approved_transaction_id
     where d.status = 'approved' and t.ingest_row_id is null;
   -- learning loop (CaptureAnalytics)
   select count(*) from ai_corrections where draft_id is not null and ingest_row_id is null;
   ```

4. **Flip the flag**: `INGEST_UNIFIED: "true"` in that environment's `vars`,
   then `npm run cf:deploy:staging` / `npm run cf:deploy`.
5. **Catch-up backfill**, right after the deploy (anything captured the old
   way between step 2 and 4; also re-syncs copies decided the old way):
   `select ingest_backfill_drafts(); select ingest_backfill_aade();`
   (SQL editor / service role only). Re-run step 3.
6. **Smoke test** (logged in):
   - upload an AADE export -> one inbox batch, R8 refuses a row without
     project/account, commit, undo, commit again;
   - photo and text capture -> inbox row with the document preview -> commit
     -> Settings «Ανάλυση Καταγραφής AI» counts it (and a corrected field);
   - inbound email -> inbox batch;
   - an old `/aade/<id>` and `/documents/<id>/review` URL redirects to its
     inbox batch; a legacy batch shows «Μεταφέρθηκε από το παλιό σύστημα» and no undo;
   - the dashboard's pending-captures count matches the inbox.
7. **Rollback** if needed: set the flag back to `"false"` and redeploy. The
   old screens still work: drafts and AADE imports finished in the inbox were
   also marked done in the old tables. Captures staged natively while the flag
   was on exist only in the inbox -- finish them there first, or note them.
8. **Phase 8 (0077)**, one release later: drop `aade_*`,
   `transaction_drafts`, `transactions.aade_staging_row_id`,
   `ai_corrections.draft_id`, the old pages and `aade/actions.ts
   commitBatch`; the 0074 views keep the history readable.

## Getting started

```bash
cp .env.local.example .env.local   # fill in Supabase project URL + keys
npm install
npm run dev
```

Database: create a Supabase project, then

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push              # applies supabase/migrations/*.sql in order
```

Applying migrations without the CLI (Management API, personal access token in
`backoffice/.env.migrate`, never committed):

```bash
node scripts/migrate-remote.mjs <project-ref> --dry-run
node scripts/migrate-remote.mjs <project-ref>
```

The one-off workbook migration scripts and the generated seed SQL hold real
business data, so they live only in the local, git-ignored `archive/` and
`backoffice/seed/` folders.

## AI layer

Disabled by default (`AI_ENABLED=false`). See the plan document for the full
design — receipt/invoice extraction, natural-language entry, and a
read-only chat assistant over the ledger, all landing in
`transaction_drafts` for mandatory human review, never auto-committed.
