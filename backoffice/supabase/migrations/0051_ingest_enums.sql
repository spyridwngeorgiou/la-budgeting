-- 0051: enums for unified ingestion (Stage → Match → Commit).
--
-- Kept in a migration of its own: a value added with ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction that adds it, and every later
-- migration (0052+) references these values in defaults and function bodies.

-- New ways money reaches the ledger. bank_pdf: an AI-read PDF statement;
-- manual_cash: the quick cash-entry screen; psd2: a future bank-API feed
-- (interface only for now, see src/lib/ingest/types.ts).
alter type tx_origin add value if not exists 'bank_pdf';
alter type tx_origin add value if not exists 'manual_cash';
alter type tx_origin add value if not exists 'psd2';

-- Where an ingest batch came from. Every value is also a tx_origin value
-- with the same label, so commit_ingest_batch (0055) can stamp the created
-- transaction with `source::text::tx_origin` -- keep the two in lockstep.
create type ingest_source as enum (
  'bank_file', 'bank_pdf', 'aade', 'ai_document', 'ai_nl', 'ai_email', 'manual', 'manual_cash', 'psd2'
);

-- staged: rows editable, nothing in the ledger yet. committed: applied by
-- commit_ingest_batch. undone: reversed by undo_ingest_batch (rows editable
-- again and the batch can be re-committed). discarded: abandoned before commit.
create type ingest_batch_status as enum ('staged', 'committed', 'undone', 'discarded');

-- document: an invoice/receipt (AADE row, AI-read photo, NL entry) that
-- creates or matches a commitment. movement: money that actually moved
-- (a bank line, a cash entry) that settles one.
create type ingest_row_kind as enum ('document', 'movement');

-- What commit does with a row.
--   create          new transaction from the row
--   settle          mark one open transaction paid (amount matches exactly)
--   settle_partial  carve a partial payment out of one open transaction
--   settle_many     mark several open transactions paid (one payment, many invoices)
--   link_existing   the movement is already in the ledger -- link it, change no money
--   skip            leave it out
--   pending         not decided yet; commit refuses while any row is pending
create type ingest_decision as enum (
  'pending', 'create', 'settle', 'settle_partial', 'settle_many', 'link_existing', 'skip'
);

-- Duplicate detection at staging time.
--   dup_external_key  the same bank line / ΜΑΡΚ is on an earlier committed batch
--   dup_in_file       repeated within this very file (kept, but flagged)
--   already_recorded  an existing transaction already accounts for it
create type ingest_dedup_status as enum ('new', 'dup_external_key', 'dup_in_file', 'already_recorded');

-- How a bank export encodes the sign of an amount.
--   signed          one amount column, negative = debit («-1.234,56»)
--   trailing_minus  one amount column, «1.234,56-» for debits (parsed like signed)
--   debit_credit    separate Χρέωση / Πίστωση columns
--   direction_column one unsigned amount column + a Χ/Π (debit/credit) marker column
create type bank_sign_mode as enum ('signed', 'trailing_minus', 'debit_credit', 'direction_column');
