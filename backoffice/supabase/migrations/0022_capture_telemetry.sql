-- 0022: capture-loop telemetry.
--
-- The Kansha Operator (photo/voice/text capture) has never run against real
-- use -- this adds the two columns needed to answer "does capture take 8
-- seconds or 80, and how often does the AI get it right" once it does,
-- without building new infrastructure: ai_usage already fires on every AI
-- call, ai_corrections already fires on every human edit at approval time.

alter table ai_usage add column latency_ms int;

-- document_id is null for every NL/voice-entry correction (those have no
-- documents row), so today a correction can never be attributed back to a
-- specific draft when the source was text/voice. draft_id works for both
-- capture paths (transaction_drafts.source is ai_document | ai_nl either
-- way), so edit-rate can finally be computed per capture method, not just
-- for photos.
alter table ai_corrections add column draft_id uuid references transaction_drafts(id) on delete cascade;
create index on ai_corrections (draft_id);
