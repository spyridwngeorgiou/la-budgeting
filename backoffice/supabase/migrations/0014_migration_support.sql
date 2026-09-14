-- 0014: supports tools/migrate_workbook.py's idempotent re-run via
-- ON CONFLICT (org_id, legacy_excel_id) DO UPDATE. legacy_excel_id is the
-- workbook's own Μοναδικό ID (or, where absent, a migration-computed
-- surrogate) -- distinct from `fingerprint`, which is recomputed from
-- (tx_date, afm, gross, mark) and used for AADE-import dedup, not migration
-- idempotency.

create unique index tx_legacy_excel_id_uq on transactions (org_id, legacy_excel_id)
  where legacy_excel_id is not null;
