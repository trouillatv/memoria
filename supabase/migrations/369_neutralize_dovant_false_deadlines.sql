-- Migration 369 — Neutralise six objets du planning Villa DOVANT matérialisés
-- à tort comme site_deadlines. Réparation bornée, traçable et idempotente.

do $repair$
declare
  target_ids constant uuid[] := array[
    '9cd43dd8-0e1f-4beb-80a5-0e8c90e23382'::uuid,
    'c2ab1fe5-6db8-47a6-88ff-0d820ed0de45'::uuid,
    'cefb7e00-e67f-451b-9f42-ebdc3e62e2e9'::uuid,
    '84c5e4b9-3249-45d9-b814-12d16832414f'::uuid,
    '4a6b318c-6b47-4295-a535-9be3ad260d3c'::uuid,
    '70067683-97e9-4132-ad51-523ec3ecb4df'::uuid
  ];
  target_count integer;
  linked_count integer;
  repaired_count integer;
begin
  select count(*) into target_count
    from public.site_deadlines
   where id = any(target_ids);
  if target_count <> 6 then
    raise exception 'Réparation DOVANT refusée : % deadlines trouvées au lieu de 6', target_count;
  end if;

  select count(*) into linked_count
    from public.document_proposal_materialization dpm
    join public.document_extraction_proposal dep on dep.id = dpm.proposal_id
    join public.site_reports sr on sr.extraction_run_id = dep.extraction_run_id
   where dpm.target_entity_type = 'site_deadline'
     and dpm.target_entity_id = any(target_ids);
  if linked_count <> 6 then
    raise exception 'Réparation DOVANT refusée : % chaînes proposition/report trouvées au lieu de 6', linked_count;
  end if;

  -- Réapplication sûre si la base de production a déjà reçu ce correctif.
  if not exists (
    select 1 from public.site_deadlines
     where id = any(target_ids)
       and (status <> 'cancelled'
         or due_date is not null
         or report_id is null
         or created_from is distinct from 'historical_import'
         or cancel_reason is distinct from 'bad_extraction')
  ) then
    return;
  end if;

  if exists (
    select 1 from public.site_deadlines
     where id = any(target_ids)
       and status in ('done', 'cancelled', 'superseded')
  ) then
    raise exception 'Réparation DOVANT refusée : une cible possède déjà un état terminal différent';
  end if;

  update public.site_deadlines dl
     set status = 'cancelled',
         due_date = null,
         report_id = source.expected_report_id,
         created_from = 'historical_import',
         cancelled_at = now(),
         cancelled_by = coalesce(source.materialized_by, dl.created_by),
         cancel_reason = 'bad_extraction',
         cancel_comment = 'P0 : objet documentaire planifié matérialisé à tort comme échéance par la régression 338',
         updated_at = now()
    from (
      select dpm.target_entity_id, sr.id as expected_report_id, dpm.created_by as materialized_by
        from public.document_proposal_materialization dpm
        join public.document_extraction_proposal dep on dep.id = dpm.proposal_id
        join public.site_reports sr on sr.extraction_run_id = dep.extraction_run_id
       where dpm.target_entity_type = 'site_deadline'
         and dpm.target_entity_id = any(target_ids)
    ) source
   where dl.id = source.target_entity_id
     and dl.id = any(target_ids);

  get diagnostics repaired_count = row_count;
  if repaired_count <> 6 then
    raise exception 'Réparation DOVANT annulée : % lignes modifiées au lieu de 6', repaired_count;
  end if;
end
$repair$;
