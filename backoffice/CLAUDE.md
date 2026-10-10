@AGENTS.md

# Kansha back office — working rules

Greek UI (el), Next.js 16 App Router + Supabase (RLS) on Cloudflare Workers via OpenNext. Middleware is `src/proxy.ts`.

## Product rules (owner decisions)
- **Classic structure stays.** Menu (`src/app/(app)/Nav.tsx`), pages, buttons, flows and calculations do not move or change. Work is **look & feel only**, page by page, unless the owner asks otherwise.
- Kept from the redesign: planner as one page with `?view=board|timeline|calendar`, forms in side drawers (`FormDrawer`), all bug fixes.
- Removed: the v2 shell and v2-only pages (`src/features`, `src/components/shell`, the `kansha_ui` switch, `UI_DEFAULT`); old v2 URLs redirect to the classic pages (`src/lib/redirects.ts`).
- Every change: staging first, prod only after the owner says «οκ».

## Release loop (one command each; prints only failures)
- `npm run check` — typecheck + lint + vitest (clears stale `.next/dev`, `.next/types`).
- `npm run ship:staging` — check → push main → wait CI → migrate staging → deploy → logged-in smoke.
- `npm run ship:prod` — CI green → JSON backup → migrate → deploy → light smoke. Only after owner «οκ».
- `npm run smoke -- staging /path /other` — logged-in GETs as a throwaway owner (deleted after). `{project}` = first project id.
- Destructive migrations (drop/delete/truncate) need `node scripts/backup-json.mjs <ref>` then `node scripts/migrate-remote.mjs <ref> --confirm-destructive`.
- Refs: staging `jpxxixhiudwjbzagidmn`, prod `hjypszddhwohgvubirkc`. Token in `.env.migrate` (never read or print it).

## Cloudflare Workers Free plan (until the owner upgrades)
- ~10 ms CPU per request with small burst tolerance; bursts of SSR requests give 503 / error 1102 **for everyone**, including prod users.
- Never hammer prod: smoke prod with ≤3 pages (ship.mjs already spaces them).
- Keep page CPU low: no `action.bind(null, id)` per list row (Next encrypts every bound arg) — pass ids as plain props/args; avoid rendering big lists twice.
- No function props from server to client components (e.g. `TrendChart` `format` — it defaults to money).

## Code conventions
- UI primitives: `@/components/ui` (barrel); `TrendChart` imported directly from `@/components/ui/TrendChart`. P15 tokens in `src/app/globals.css`: square corners, no shadows, no hex colours in code (design-guard test).
- Greek strings in `src/lib/i18n/el.ts` (texts of the restyled `components/ui` and planner in `src/lib/i18n/v2/*`).
- Migrations: next free number in `supabase/migrations/`, each with a pgTAP test in `supabase/tests/`. Fixture rows: `has_invoice=true` when VAT/withholding ≠ 0, `paid_on` when status is paid.
- `src/lib/db/types.ts`: add new views/functions by hand (no local Supabase on this machine).
- Budget (`budgets.json`, `src/lib/budgets.test.ts`) caps the (app) page count; never raise it without a reason in `$comment`.

## Token-saving habits
- Run the npm scripts above instead of raw build/test commands; don't paste logs — the scripts already filter them.
- Prefer `Grep`/`Read` with offsets over reading whole files; never read `.next/`, `backups/`, `package-lock.json`.
- Delegate large multi-file work to one worktree agent per page/area; merge with `git merge --no-ff`, then `npm run ship:staging`.
- Git Bash on Windows: prefix node commands that take `/paths` with `MSYS_NO_PATHCONV=1` (ship.mjs does it internally); use Python urllib, not curl, for requests with Greek text.
