-- Buckets Supabase Storage (privés, signed URLs depuis l'app)

insert into storage.buckets (id, name, public) values
  ('tender-documents',  'tender-documents',  false),
  ('mission-photos',    'mission-photos',    false),
  ('report-pdfs',       'report-pdfs',       false),
  ('library-documents', 'library-documents', false)
on conflict (id) do nothing;

-- Storage policies : authenticated users can read (SELECT) all buckets.
-- Server Actions using SUPABASE_SERVICE_ROLE_KEY bypass RLS for INSERT/UPDATE/DELETE.

drop policy if exists "tender-documents read for authenticated" on storage.objects;
create policy "tender-documents read for authenticated"
  on storage.objects for select
  using (bucket_id = 'tender-documents' and auth.role() = 'authenticated');

drop policy if exists "mission-photos read for authenticated" on storage.objects;
create policy "mission-photos read for authenticated"
  on storage.objects for select
  using (bucket_id = 'mission-photos' and auth.role() = 'authenticated');

drop policy if exists "report-pdfs read for authenticated" on storage.objects;
create policy "report-pdfs read for authenticated"
  on storage.objects for select
  using (bucket_id = 'report-pdfs' and auth.role() = 'authenticated');

drop policy if exists "library-documents read for authenticated" on storage.objects;
create policy "library-documents read for authenticated"
  on storage.objects for select
  using (bucket_id = 'library-documents' and auth.role() = 'authenticated');
