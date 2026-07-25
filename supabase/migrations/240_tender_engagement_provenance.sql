-- Preserve the source document and page for tender engagements.

alter table public.engagements
  add column if not exists tender_document_id uuid,
  add column if not exists page_number integer;

alter table public.engagements
  add constraint engagements_page_number_positive
    check (page_number is null or page_number > 0),
  add constraint engagements_page_requires_document
    check (page_number is null or tender_document_id is not null);

alter table public.tender_documents
  add constraint tender_documents_tender_id_id_key unique (tender_id, id);

alter table public.engagements
  add constraint engagements_tender_document_tender_id_fkey
    foreign key (tender_id, tender_document_id)
    references public.tender_documents (tender_id, id)
    on update restrict
    on delete no action;

create or replace function public.clear_engagement_tender_document_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.engagements
  set tender_document_id = null,
      page_number = null
  where tender_id = old.tender_id
    and tender_document_id = old.id;

  return old;
end;
$$;

create trigger tender_documents_clear_engagement_provenance_before_delete
before delete on public.tender_documents
for each row
execute function public.clear_engagement_tender_document_provenance();
