-- 0025: client contract value.
--
-- A project with business_model='client_project' (Kansha builds/installs for
-- a paying client, rather than developing its own asset) previously had no
-- revenue baseline at all -- budget/actual tracks spend, but there was
-- nothing to bill or track billing against. This is the S-sized unlock:
-- one number, the agreed contract value, so "billed to date" vs "contract
-- value" becomes answerable from the ledger that already exists.
alter table projects add column contract_value numeric(14,2);
alter table projects add column contract_signed_date date;
