-- 0015: Storage bucket for uploaded AADE myDATA export files.
-- Private bucket; access gated by org membership via a path-prefix check
-- (every object is stored at "<org_id>/<filename>").

insert into storage.buckets (id, name, public)
values ('aade-imports', 'aade-imports', false)
on conflict (id) do nothing;

create policy aade_imports_select on storage.objects for select
  using (bucket_id = 'aade-imports' and (storage.foldername(name))[1]::uuid in (select my_org_ids()));

create policy aade_imports_insert on storage.objects for insert
  with check (bucket_id = 'aade-imports' and (storage.foldername(name))[1]::uuid in (select my_org_ids()));
