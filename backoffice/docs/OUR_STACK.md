# Kansha back office — our own stack (handover)

Living document: updated with every change. **No secrets here** — this repo is
public. Secret values live only in the places listed in §4.

Last update: 14/10/2026 (Money Manager import).

## 1. What runs where

| Piece | Where | Notes |
|---|---|---|
| App (Next.js 16 via OpenNext) | Cloudflare Worker `kansha-backoffice` → https://kansha-backoffice.kansha-chris.workers.dev | Cloudflare account of create@chriskansha.com. Config: `wrangler.own.jsonc` |
| Database, auth, storage | Supabase project `lbbwawezlymiapoacdhw` («kanshabackoffice», eu-central-1) | Org `xldwqrwhoenvrbbytedi`. Spyros invited as Developer |
| Scheduled jobs | Supabase `pg_cron` | see §3 |
| Code | branch `kansha/kentro-elegxou` of `spyridwngeorgiou/la-budgeting` | local commits; push only with Christos' OK |

Spyros' original live/staging projects are untouched.

## 2. Data

- Single org **Kansha** (ΑΦΜ 802801650). Members: create@chriskansha.com (owner), sg@chriskansha.com (admin).
- Loaded from «Επιχειρησιακό Αρχείο 190» (13/10/2026); balances matched the workbook to the cent. Cash counted 199.925 on 13/10.
- Opening balances date: 21/08/2026. Balance rule (0022): paid rows with `coalesce(paid_on, tx_date) > opening date`.

## 3. Automations

| Job | When | What |
|---|---|---|
| `mydata-daily-sync` | 04:30 UTC daily | `call_mydata_sync()` → POST `/api/sync/mydata` → fetches received + issued invoices of the last 45 days from ΑΑΔΕ myDATA (read-only), stages only new ΜΑΡΚ in `aade_import_batches/aade_staging_rows` for review on `/aade`. Never commits to the ledger by itself. |
| `roll-forward-installment-plans` | 03:00 UTC daily | rolls indefinite plans forward |
| Money Manager (phone) | when Christos sends it | iPhone shortcut «Στείλε στην Kansha» → POST `/api/import/money-manager` (header `x-import-key`) → staged in `mm_imports/mm_rows` (new vs already in ledger) → decisions on `/money-manager`. |

Manual: «Λήψη τώρα» on `/aade`. Responses of the scheduled call: `net._http_response`.

## 4. Secrets — names and where they live (values are NOT here)

| Name | Lives in | Purpose |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Worker secret | only for `/api/sync/*` (no user signed in) |
| `MYDATA_USER_ID`, `MYDATA_SUBSCRIPTION_KEY` | Cloudflare Worker secrets | myDATA REST API (user `kanshabackoffice`) |
| `IMPORT_KEY` | Cloudflare Worker secret (and in Christos' iPhone shortcut) | phone → Money Manager import |
| `SYNC_SECRET` | Cloudflare Worker secret **and** Supabase Vault (`sync_secret`) | authenticates the daily call |
| `app_url` | Supabase Vault | where the daily call goes |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.production.local` (build time) | public by design (RLS protects data) |
| all of the above + `SUPABASE_ACCESS_TOKEN` | Christos' machine: `backoffice/.env.own.local` (gitignored) | scripts and deploy |

To work locally, a developer gets URL + keys from the Supabase dashboard
(Project Settings → API) — they are not passed around. If a value must be
shared, use a password manager's secure share, never chat or email.

## 5. Everyday commands (from `backoffice/`)

```bash
node scripts/own.cjs migrate                 # apply new supabase/migrations/*.sql
node scripts/own.cjs sql "select …"          # one-off query (Management API)
node scripts/staging.cjs <cmd> --own         # inspect | balances | refs | add <entry.json> | load <xlsx> [--write]
node scripts/own-dump.cjs <out.sql>          # full backup (schema + data)

# deploy
npx opennextjs-cloudflare build
rm -f .open-next/server-functions/default/.env.production   # tracked file with the old live ref
npx opennextjs-cloudflare deploy --config wrangler.own.jsonc
```

## 6. Migrations added on our stack

| # | What |
|---|---|
| 0022 | balances by payment date |
| 0023 | project files (Drive catalogue + uploads) |
| 0024 | activity log (Ιστορικό) |
| 0025 | enum values that exist on live |
| 0026 | activity log skips rows of a deleted org |
| 0027 | project phases (timeline on the project page) |
| 0028 | daily myDATA sync (pg_net + pg_cron + Vault) |
| 0029 | Money Manager import staging (mm_imports, mm_rows) |

## 7. Conventions in the data

- `[ΠΡΟΒΛΕΨΗ]` at the start of a transaction's notes = estimate, a switch in Σενάρια (off by default). On an instalment plan's notes: the whole plan is not activated yet («[ΠΡΟΒΛΕΨΗ] <name>.» → one monthly switch).
- `[ΜΕ ΔΑΝΕΙΟ]` = paid only if the bank loan happens (moves with the loan switch).
- Rows whose description starts «Προσφορά VK» = an alternative to the Q004 renovation plan, never added on top.

## 8. Connectors — status

| Source | Status |
|---|---|
| myDATA (ΑΑΔΕ) | ✅ live, daily |
| Money Manager (cash) | ✅ iPhone shortcut, one tap (iOS has no automatic export) |
| Gmail invoices / Drive inbox | planned |
| Banks (PSD2, up to 4×/day) | planned via Enable Banking; Optima coverage to confirm |

## 9. Added 28–29/10/2026

| Piece | Where / how |
|---|---|
| Duplicate check for every entry path | `possible_duplicates()` (0030) — same direction and amount, ±7 days. Used by `staging.cjs add` (stops unless `allow_duplicate`), the connector, the bank feed. |
| Claude / ChatGPT connector | Worker `kansha-connector` (`backoffice/connector/`), https://kansha-connector.kansha-chris.workers.dev/mcp. OAuth (workers-oauth-provider, KV `OAUTH_KV`), sign-in with the Kansha app account, only claude.ai / chatgpt.com redirect hosts. Read tools + two-step writes (`kansha_prepare_*` → `kansha_confirm`, signed single-use token, never deletes). Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `CONFIRM_SECRET`. Deploy from `backoffice/connector`: `../node_modules/.bin/wrangler deploy`. |
| Shared board «Εντολές & σημειώσεις» | table `ai_notes` (0031); connector tools `kansha_notes` / `kansha_note_add` / `kansha_note_done`; VS Code: `node scripts/staging.cjs notes --own`, `note-done <id> <text> --own`; shown on Ειδοποιήσεις. |
| Money Manager from Claude/ChatGPT | connector tool `kansha_money_manager_send`: the chat reads the export and sends the rows; staged in `mm_imports`/`mm_rows` exactly like the file upload (matched against cash ±1 day); an older draft inside the same period is replaced; nothing reaches the ledger until approved on /money-manager. |
| Bank feed | Enable Banking (PSD2, read-only), app id `8afd326d-645e-4472-bc38-877d85e52894`, restricted mode (accounts must first be linked in the Enable Banking control panel). Tables 0032 (`bank_connections`, `bank_links`, `bank_tx`, `bank_sync_runs`); page `/bank`; `/api/sync/bank` 3×/day (0033, 05/11/17 UTC). Worker secrets `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY`. Feed starts 2026-10-13. Bank lines are identified by content (Optima changes `entry_reference` per request). Optima Εταιρικός live; Πειραιώς: app approval step fails (Enable Banking beta) — statements meanwhile. |
| Spark (mail) in Claude Code | official Readdle MCP, `C:\Users\Admin\.mcp.json` on Christos' PC; three accounts. |
