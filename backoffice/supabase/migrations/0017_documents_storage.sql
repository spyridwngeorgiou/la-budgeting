-- 0017: Storage bucket for uploaded receipt/invoice photos (AI extraction).
-- Same path-prefix-gated pattern as aade-imports (0015): private bucket,
-- objects stored at "<org_id>/<filename>".

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy documents_bucket_select on storage.objects for select
  using (bucket_id = 'documents' and (storage.foldername(name))[1]::uuid in (select my_org_ids()));

create policy documents_bucket_insert on storage.objects for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1]::uuid in (select my_org_ids()));
