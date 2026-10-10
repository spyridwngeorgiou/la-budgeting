-- 0062: enums for the finance layer (0063-0069).
--
-- On its own because ALTER TYPE ... ADD VALUE cannot be used by the same
-- transaction that adds it: 0063 already writes 'principal'.

-- cost_treatment (0020) gains the two flows that are neither revenue nor
-- cost. 'financing' keeps its meaning of interest + bank charges (a real
-- P&L cost); a loan's principal moving in or out, and the owner putting
-- money in or taking it out, change the balance sheet only.
alter type cost_treatment add value if not exists 'principal';
alter type cost_treatment add value if not exists 'equity';

-- What part of the business a project (and so every euro on it) belongs to.
-- The P&L by line and the forecast filter read this; derived from
-- project_type / business_model by a trigger (0063), overridable per project.
create type business_line as enum ('hospitality', 'construction', 'brokerage', 'investments', 'general');

-- Brokerage deals (0065): deliberately a short pipeline, not a CRM.
create type deal_stage as enum ('lead', 'offer', 'preliminary', 'closed', 'lost');

-- expected_income rows (0008) leave the forecast once they turn into a real
-- transaction or fall through.
create type expected_status as enum ('expected', 'received', 'cancelled');
