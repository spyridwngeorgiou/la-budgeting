-- AADE commit parity (0071): the old importer (aade/actions.ts commitBatch)
-- and commit_ingest_batch must write the same transactions for the same
-- AADE export. Side-by-side, half 2 of 2 -- half 1 is
-- src/lib/ingest/adapters/aadeFile.test.ts, which checks that the two JSON
-- blocks below are exactly what each path's TypeScript produces for the
-- fixture in src/lib/aade/__fixtures__/parity.ts:
--   «legacy»  the transactions commitBatch inserts (plus the ΑΦΜ/name its
--             resolveOrCreateContact looks up), replayed here the same way;
--   «ingest»  the ingest_rows the unified upload stages, committed here by
--             commit_ingest_batch.
-- The two ledgers are then diffed column by column. Excluded on purpose:
-- ids, timestamps, created_by (R20), aade_staging_row_id / ingest_row_id
-- (R19). Rules: src/lib/aade/commitRules.ts.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'parity@test.local');
create temp table t_org as
  select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000000d1';
grant select on t_org to authenticated;
create function pg_temp.org() returns uuid language sql stable as $$ select org_id from t_org $$;
create function pg_temp.as_user() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
$$;

update orgs set own_afm = '999999999' where id = pg_temp.org();
insert into projects (id, org_id, code, display_name)
values ('71000000-0000-0000-0000-000000000001', pg_temp.org(), 'PAR', 'Έργο ισοτιμίας');
insert into categories (id, org_id, name)
values ('71000000-0000-0000-0000-000000000002', pg_temp.org(), 'Κατηγορία ισοτιμίας');
insert into accounts (id, org_id, name, owner_scope, opening_balance, opening_balance_date)
values ('71000000-0000-0000-0000-000000000003', pg_temp.org(), 'Τράπεζα', 'corporate', 0, date '2026-01-01');

create temp table t_fixture as select
$legacy$[
{"row_no":2,"contact_afm":"111111111","contact_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","tx_date":"2026-03-02","counterparty_afm":"111111111","counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":124,"net_amount":100,"vat_amount":24,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"invoice_number":"ΤΔΑ/1","mydata_mark":"400000000000001","document_type":"Τιμολόγιο Παροχής Υπηρεσιών","aade_discrepancy":null},
{"row_no":3,"contact_afm":"222222222","contact_name":"ΠΕΛΑΤΗΣ ΒΗΤΑ","tx_date":"2026-03-03","counterparty_afm":"222222222","counterparty_name":"ΠΕΛΑΤΗΣ ΒΗΤΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"income","scope":"business","status":"paid","origin":"aade","gross_amount":1000,"net_amount":1000,"vat_amount":0,"withholding_amount":0,"other_taxes":0,"has_invoice":false,"invoice_number":"Α/7","mydata_mark":"400000000000002","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null},
{"row_no":4,"contact_afm":"333333333","contact_name":"ΠΕΛΑΤΗΣ ΓΑΜΜΑ","tx_date":"2026-03-04","counterparty_afm":"333333333","counterparty_name":"ΠΕΛΑΤΗΣ ΓΑΜΜΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"income","scope":"business","status":"paid","origin":"aade","gross_amount":1040,"net_amount":1000,"vat_amount":240,"withholding_amount":200,"other_taxes":0,"has_invoice":true,"invoice_number":"Α/8","mydata_mark":"400000000000003","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":"Απόκλιση"},
{"row_no":5,"contact_afm":"111111111","contact_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","tx_date":"2026-03-05","counterparty_afm":"111111111","counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":66,"net_amount":50,"vat_amount":12,"withholding_amount":0,"other_taxes":3,"has_invoice":true,"invoice_number":"ΤΔΑ/2","mydata_mark":"400000000000004","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null},
{"row_no":8,"contact_afm":"555555555","contact_name":"ΕΦΟΡΙΑ ΔΙΑΦΟΡΑ","tx_date":"2026-03-08","counterparty_afm":"555555555","counterparty_name":"ΕΦΟΡΙΑ ΔΙΑΦΟΡΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":24,"net_amount":0,"vat_amount":24,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"invoice_number":"ΠΦ/1","mydata_mark":"400000000000007","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null},
{"row_no":9,"contact_afm":"666666666","contact_name":"ΔΩΡΕΑΝ","tx_date":"2026-03-09","counterparty_afm":"666666666","counterparty_name":"ΔΩΡΕΑΝ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":0,"net_amount":0,"vat_amount":0,"withholding_amount":0,"other_taxes":0,"has_invoice":false,"invoice_number":"Δ/1","mydata_mark":"400000000000008","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null},
{"row_no":10,"contact_afm":null,"contact_name":"ΛΙΑΝΙΚΗ ΠΩΛΗΣΗ","tx_date":"2026-03-10","counterparty_afm":null,"counterparty_name":"ΛΙΑΝΙΚΗ ΠΩΛΗΣΗ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":24.8,"net_amount":20,"vat_amount":4.8,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"invoice_number":"ΑΛΠ/9","mydata_mark":"400000000000009","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null},
{"row_no":11,"contact_afm":"777777777","contact_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΔΕΛΤΑ","tx_date":"2026-03-11","counterparty_afm":"777777777","counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΔΕΛΤΑ","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","account_id":"71000000-0000-0000-0000-000000000003","direction":"expense","scope":"business","status":"paid","origin":"aade","gross_amount":99.2,"net_amount":80,"vat_amount":19.2,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"invoice_number":"ΤΔΑ/3","mydata_mark":"400000000000010","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null}
]$legacy$::jsonb as legacy,
$ingest$[
{"row_no":2,"row_kind":"document","raw":{"row":2},"extracted":{"afms":["111111111","999999999"],"ibans":[],"rfs":[],"marks":["400000000000001"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"111111111","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46114-111111111-124.00-400000000000001"},"external_key":"400000000000001","tx_date":"2026-03-02","value_date":null,"due_date":null,"direction":"expense","amount":124,"net_amount":100,"vat_amount":24,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","counterparty_afm":"111111111","counterparty_iban":null,"reference":null,"invoice_number":"ΤΔΑ/1","mydata_mark":"400000000000001","document_type":"Τιμολόγιο Παροχής Υπηρεσιών","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":3,"row_kind":"document","raw":{"row":3},"extracted":{"afms":["999999999","222222222"],"ibans":[],"rfs":[],"marks":["400000000000002"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"999999999","receiver_afm":"222222222","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46115-222222222-1000.00-400000000000002"},"external_key":"400000000000002","tx_date":"2026-03-03","value_date":null,"due_date":null,"direction":"income","amount":1000,"net_amount":1000,"vat_amount":0,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":false,"description":null,"counterparty_name":"ΠΕΛΑΤΗΣ ΒΗΤΑ","counterparty_afm":"222222222","counterparty_iban":null,"reference":null,"invoice_number":"Α/7","mydata_mark":"400000000000002","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":4,"row_kind":"document","raw":{"row":4},"extracted":{"afms":["999999999","333333333"],"ibans":[],"rfs":[],"marks":["400000000000003"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"999999999","receiver_afm":"333333333","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46116-333333333-1040.00-400000000000003"},"external_key":"400000000000003","tx_date":"2026-03-04","value_date":null,"due_date":null,"direction":"income","amount":1040,"net_amount":1000,"vat_amount":240,"vat_rate":null,"withholding_amount":200,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΠΕΛΑΤΗΣ ΓΑΜΜΑ","counterparty_afm":"333333333","counterparty_iban":null,"reference":null,"invoice_number":"Α/8","mydata_mark":"400000000000003","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":"Απόκλιση","balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":5,"row_kind":"document","raw":{"row":5},"extracted":{"afms":["111111111","999999999"],"ibans":[],"rfs":[],"marks":["400000000000004"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"111111111","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":1,"deductions":null,"fingerprint":"46117-111111111-66.00-400000000000004"},"external_key":"400000000000004","tx_date":"2026-03-05","value_date":null,"due_date":null,"direction":"expense","amount":66,"net_amount":50,"vat_amount":12,"vat_rate":null,"withholding_amount":0,"other_taxes":3,"has_invoice":true,"description":null,"counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ","counterparty_afm":"111111111","counterparty_iban":null,"reference":null,"invoice_number":"ΤΔΑ/2","mydata_mark":"400000000000004","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":6,"row_kind":"document","raw":{"row":6},"extracted":{"afms":["444444444","999999999"],"ibans":[],"rfs":[],"marks":["400000000000001"]},"meta":{"aade_dedup_status":"dup_in_batch","matched_transaction_id":null,"issuer_afm":"444444444","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46118-444444444-12.40-400000000000001"},"external_key":"400000000000001","tx_date":"2026-03-06","value_date":null,"due_date":null,"direction":"expense","amount":12.4,"net_amount":10,"vat_amount":2.4,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΑΛΛΟΣ","counterparty_afm":"444444444","counterparty_iban":null,"reference":null,"invoice_number":"Χ/1","mydata_mark":"400000000000001","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"dup_in_file","decision":"skip","decision_targets":[],"parse_errors":[]},
{"row_no":7,"row_kind":"document","raw":{"row":7},"extracted":{"afms":["999999999"],"ibans":[],"rfs":[],"marks":["400000000000005"]},"meta":{"aade_dedup_status":"dup_self_classification","matched_transaction_id":null,"issuer_afm":null,"receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46114--124.00-400000000000005"},"external_key":"400000000000005","tx_date":"2026-03-02","value_date":null,"due_date":null,"direction":"expense","amount":124,"net_amount":100,"vat_amount":24,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":null,"counterparty_afm":null,"counterparty_iban":null,"reference":null,"invoice_number":null,"mydata_mark":"400000000000005","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"dup_in_file","decision":"skip","decision_targets":[],"parse_errors":[]},
{"row_no":8,"row_kind":"document","raw":{"row":8},"extracted":{"afms":["555555555","999999999"],"ibans":[],"rfs":[],"marks":["400000000000007"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"555555555","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46120-555555555-24.00-400000000000007"},"external_key":"400000000000007","tx_date":"2026-03-08","value_date":null,"due_date":null,"direction":"expense","amount":24,"net_amount":0,"vat_amount":24,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΕΦΟΡΙΑ ΔΙΑΦΟΡΑ","counterparty_afm":"555555555","counterparty_iban":null,"reference":null,"invoice_number":"ΠΦ/1","mydata_mark":"400000000000007","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":9,"row_kind":"document","raw":{"row":9},"extracted":{"afms":["666666666","999999999"],"ibans":[],"rfs":[],"marks":["400000000000008"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"666666666","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46121-666666666-0.00-400000000000008"},"external_key":"400000000000008","tx_date":"2026-03-09","value_date":null,"due_date":null,"direction":"expense","amount":0,"net_amount":0,"vat_amount":0,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":false,"description":null,"counterparty_name":"ΔΩΡΕΑΝ","counterparty_afm":"666666666","counterparty_iban":null,"reference":null,"invoice_number":"Δ/1","mydata_mark":"400000000000008","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":10,"row_kind":"document","raw":{"row":10},"extracted":{"afms":["999999999"],"ibans":[],"rfs":[],"marks":["400000000000009"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":null,"receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46122--24.80-400000000000009"},"external_key":"400000000000009","tx_date":"2026-03-10","value_date":null,"due_date":null,"direction":"expense","amount":24.8,"net_amount":20,"vat_amount":4.8,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΛΙΑΝΙΚΗ ΠΩΛΗΣΗ","counterparty_afm":null,"counterparty_iban":null,"reference":null,"invoice_number":"ΑΛΠ/9","mydata_mark":"400000000000009","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]},
{"row_no":11,"row_kind":"document","raw":{"row":11},"extracted":{"afms":["777777777","999999999"],"ibans":[],"rfs":[],"marks":["400000000000010"]},"meta":{"aade_dedup_status":"new","matched_transaction_id":null,"issuer_afm":"777777777","receiver_afm":"999999999","kad_code":null,"kad_description":null,"digital_fee":null,"fees":null,"deductions":null,"fingerprint":"46123-777777777-0.00-400000000000010"},"external_key":"400000000000010","tx_date":"2026-03-11","value_date":null,"due_date":null,"direction":"expense","amount":99.2,"net_amount":80,"vat_amount":19.2,"vat_rate":null,"withholding_amount":0,"other_taxes":0,"has_invoice":true,"description":null,"counterparty_name":"ΠΡΟΜΗΘΕΥΤΗΣ ΔΕΛΤΑ","counterparty_afm":"777777777","counterparty_iban":null,"reference":null,"invoice_number":"ΤΔΑ/3","mydata_mark":"400000000000010","document_type":"Τιμολόγιο Πώλησης","aade_discrepancy":null,"balance_after":null,"status":"paid","paid_on":null,"account_id":"71000000-0000-0000-0000-000000000003","project_id":"71000000-0000-0000-0000-000000000001","category_id":"71000000-0000-0000-0000-000000000002","contact_id":null,"document_id":null,"scope":"business","dedup_status":"new","decision":"create","decision_targets":[],"parse_errors":[]}
]$ingest$::jsonb as ingest;
grant select on t_fixture to authenticated;

-- The old path, statement for statement: for every importable staging row,
-- resolveOrCreateContact(afm, name) then insert legacyAadeTransaction(row).
create function pg_temp.legacy_commit() returns int language plpgsql as $$
declare
  p jsonb;
  v_contact uuid;
  n int := 0;
begin
  for p in select x from t_fixture, jsonb_array_elements(legacy) x order by (x->>'row_no')::int loop
    v_contact := null;
    if p->>'contact_afm' is not null then
      select id into v_contact from contacts where org_id = pg_temp.org() and afm = p->>'contact_afm';
      if v_contact is null then
        insert into contacts (org_id, name, afm)
        values (pg_temp.org(), coalesce(p->>'contact_name', p->>'contact_afm'), p->>'contact_afm')
        returning id into v_contact;
      end if;
    end if;
    insert into transactions (
      org_id, tx_date, contact_id, counterparty_afm, counterparty_name, project_id, category_id, account_id,
      direction, scope, status, origin, gross_amount, net_amount, vat_amount, withholding_amount, other_taxes,
      has_invoice, invoice_number, mydata_mark, document_type, aade_discrepancy
    ) values (
      pg_temp.org(), (p->>'tx_date')::date, v_contact, p->>'counterparty_afm', p->>'counterparty_name',
      (p->>'project_id')::uuid, (p->>'category_id')::uuid, (p->>'account_id')::uuid,
      (p->>'direction')::tx_direction, (p->>'scope')::tx_scope, (p->>'status')::tx_status, (p->>'origin')::tx_origin,
      (p->>'gross_amount')::numeric, (p->>'net_amount')::numeric, (p->>'vat_amount')::numeric,
      (p->>'withholding_amount')::numeric, (p->>'other_taxes')::numeric, (p->>'has_invoice')::boolean,
      p->>'invoice_number', p->>'mydata_mark', p->>'document_type', p->>'aade_discrepancy'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- What a transaction "is", minus identity/audit columns, with the contact
-- by value (its id differs between the two runs).
create function pg_temp.ledger() returns table (j jsonb) language sql stable as $$
  select (to_jsonb(t) - array['id', 'org_id', 'created_at', 'updated_at', 'created_by',
                              'aade_staging_row_id', 'ingest_row_id', 'contact_id'])
         || jsonb_build_object('contact', (select jsonb_build_object('afm', c.afm, 'name', c.name)
                                           from contacts c where c.id = t.contact_id))
  from transactions t where t.org_id = pg_temp.org()
$$;

-- ------------------------------------------------------------ old way
select pg_temp.as_user();
select is(pg_temp.legacy_commit(), 8, 'old path: 8 of the 10 rows imported (two duplicates skipped)');
reset role;

create temp table t_old as select j from pg_temp.ledger();
create temp table t_old_contacts as select afm, name from contacts where org_id = pg_temp.org();
grant select on t_old, t_old_contacts to authenticated;

-- Back to an empty ledger for the second run.
delete from transactions where org_id = pg_temp.org();
delete from contacts where org_id = pg_temp.org();

-- ------------------------------------------------------------ new way
insert into ingest_batches (id, org_id, source, filename)
values ('72000000-0000-0000-0000-000000000001', pg_temp.org(), 'aade', '2026-03_expenses.xlsx');

insert into ingest_rows (
  org_id, batch_id, row_no, row_kind, raw, extracted, meta, external_key, tx_date, value_date, due_date, direction,
  amount, net_amount, vat_amount, vat_rate, withholding_amount, other_taxes, has_invoice, description,
  counterparty_name, counterparty_afm, counterparty_iban, reference, invoice_number, mydata_mark, document_type,
  aade_discrepancy, balance_after, status, paid_on, account_id, project_id, category_id, contact_id, document_id,
  scope, dedup_status, decision, decision_targets, parse_errors)
select pg_temp.org(), '72000000-0000-0000-0000-000000000001', r.row_no, r.row_kind, r.raw, r.extracted, r.meta,
  r.external_key, r.tx_date, r.value_date, r.due_date, r.direction, r.amount, r.net_amount, r.vat_amount, r.vat_rate,
  r.withholding_amount, r.other_taxes, r.has_invoice, r.description, r.counterparty_name, r.counterparty_afm,
  r.counterparty_iban, r.reference, r.invoice_number, r.mydata_mark, r.document_type, r.aade_discrepancy,
  r.balance_after, r.status, r.paid_on, r.account_id, r.project_id, r.category_id, r.contact_id, r.document_id,
  r.scope, r.dedup_status, r.decision, r.decision_targets, r.parse_errors
from t_fixture, jsonb_populate_recordset(null::ingest_rows, ingest) r;

select pg_temp.as_user();
select is(
  commit_ingest_batch('72000000-0000-0000-0000-000000000001',
    (select version from ingest_batches where id = '72000000-0000-0000-0000-000000000001')),
  '{"create": 8, "settle": 0, "settle_partial": 0, "settle_many": 0, "link_existing": 0, "skip": 2}'::jsonb,
  'new path: commit_ingest_batch creates the same 8 and skips the same 2');

-- --------------------------------------------------------------- diff
select set_eq('select j from pg_temp.ledger()', 'select j from t_old',
  'both paths write identical transactions (every compared column)');
select set_eq('select afm, name from contacts where org_id = pg_temp.org()', 'select afm, name from t_old_contacts',
  'both paths find or create the same contacts');

select is((select count(*) from transactions where org_id = pg_temp.org() and paid_on is null and status = 'paid')::int, 8,
  'R14: paid, payment date left open');
select is((select count(*) from transactions t join ingest_rows r on r.id = t.ingest_row_id
           where t.org_id = pg_temp.org() and t.created_by = '00000000-0000-0000-0000-0000000000d1')::int, 8,
  'R19/R20: every new transaction links its ingest row and records who committed it');

-- ---------------------------------------------------- refusals (R8, R16)
reset role;
insert into ingest_batches (id, org_id, source, filename) values
  ('72000000-0000-0000-0000-000000000002', pg_temp.org(), 'aade', 'no-project.xlsx'),
  ('72000000-0000-0000-0000-000000000003', pg_temp.org(), 'aade', 'same-mark.xlsx'),
  ('72000000-0000-0000-0000-000000000004', pg_temp.org(), 'aade', 'same-fingerprint.xlsx'),
  ('72000000-0000-0000-0000-000000000005', pg_temp.org(), 'bank_file', 'zero.csv');
insert into ingest_rows (org_id, batch_id, row_no, row_kind, raw, tx_date, direction, amount, net_amount, vat_amount,
                         counterparty_afm, mydata_mark, external_key, status, project_id, account_id, decision)
values
  (pg_temp.org(), '72000000-0000-0000-0000-000000000002', 1, 'document', '{}', date '2026-04-01', 'expense', 10, 10, 0,
   '888888888', '400000000000090', '400000000000090', 'paid', null, '71000000-0000-0000-0000-000000000003', 'create'),
  (pg_temp.org(), '72000000-0000-0000-0000-000000000003', 1, 'document', '{}', date '2026-04-01', 'expense', 10, 10, 0,
   '888888888', '400000000000002', null, 'paid', '71000000-0000-0000-0000-000000000001',
   '71000000-0000-0000-0000-000000000003', 'create'),
  -- row 9 of the fixture minus its ΜΑΡΚ would still collide with a ΜΑΡΚ-less twin:
  (pg_temp.org(), '72000000-0000-0000-0000-000000000004', 1, 'document', '{}', date '2026-04-02', 'expense', 15, 15, 0,
   '888888888', null, null, 'paid', '71000000-0000-0000-0000-000000000001',
   '71000000-0000-0000-0000-000000000003', 'create'),
  (pg_temp.org(), '72000000-0000-0000-0000-000000000005', 1, 'movement', '{}', date '2026-04-02', 'expense', 0, 0, 0,
   null, null, null, null, null, '71000000-0000-0000-0000-000000000003', 'create');
insert into transactions (org_id, tx_date, counterparty_afm, direction, status, origin, gross_amount, net_amount)
values (pg_temp.org(), date '2026-04-02', '888888888', 'expense', 'paid', 'aade', 15, 15);

select pg_temp.as_user();
select throws_ok($$ select commit_ingest_batch('72000000-0000-0000-0000-000000000002', 1) $$,
  'P0001', '1 γραμμή/ες δεν έχουν έργο ή λογαριασμό. Συμπληρώστε πριν την οριστικοποίηση.',
  'R8: refused while a row has no project');
select throws_ok($$ select commit_ingest_batch('72000000-0000-0000-0000-000000000003', 1) $$,
  'P0001', 'Γραμμή 1: υπάρχει ήδη κίνηση με αυτό το ΜΑΡΚ.', 'R16: ΜΑΡΚ collision refused in words');
select throws_ok($$ select commit_ingest_batch('72000000-0000-0000-0000-000000000004', 1) $$,
  'P0001', 'Γραμμή 1: υπάρχει ήδη ίδια κίνηση AADE (ίδια ημερομηνία, ΑΦΜ, ποσό και ΜΑΡΚ).',
  'R16: fingerprint collision refused in words');
select throws_ok($$ select commit_ingest_batch('72000000-0000-0000-0000-000000000005', 1) $$,
  'P0001', 'Γραμμή 1: λείπει ημερομηνία, κατεύθυνση ή ποσό.', 'a zero amount is only accepted from AADE');
select is((select count(*) from transactions where org_id = pg_temp.org())::int, 9,
  'nothing was written by the refused commits');
select is((select count(*) from contacts where afm = '888888888')::int, 0,
  'a refused commit leaves no contact behind');
reset role;

select * from finish();
rollback;
