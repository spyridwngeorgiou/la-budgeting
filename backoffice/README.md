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

Migrating the existing workbook data:

```bash
py tools/migrate_workbook.py --dry-run     # verify zero unmapped literals first
py tools/migrate_workbook.py --out backoffice/seed/0100_migrated_data.sql
psql "$DATABASE_URL" -f backoffice/seed/0100_migrated_data.sql
py tools/verify_migration.py               # requires DATABASE_URL
```

See `tools/MIGRATION_NOTES.md` for what has and hasn't landed yet.

## AI layer

Disabled by default (`AI_ENABLED=false`). See the plan document for the full
design — receipt/invoice extraction, natural-language entry, and a
read-only chat assistant over the ledger, all landing in
`transaction_drafts` for mandatory human review, never auto-committed.
