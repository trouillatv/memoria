-- P0 DOVANT — DRY-RUN UNIQUEMENT.
-- Produit l'avant/après projeté des six faux site_deadlines sans aucune écriture.
-- L'UPDATE correspondant ne doit être exécuté qu'après GO explicite.

with dovant_deadline_ids(id) as (
  values
    ('9cd43dd8-0e1f-4beb-80a5-0e8c90e23382'::uuid),
    ('c2ab1fe5-6db8-47a6-88ff-0d820ed0de45'::uuid),
    ('cefb7e00-e67f-451b-9f42-ebdc3e62e2e9'::uuid),
    ('84c5e4b9-3249-45d9-b814-12d16832414f'::uuid),
    ('4a6b318c-6b47-4295-a535-9be3ad260d3c'::uuid),
    ('70067683-97e9-4132-ad51-523ec3ecb4df'::uuid)
), source as (
  select
    dl.*,
    dep.id as source_proposal_id,
    dep.label as source_label,
    dep.source_payload,
    sr.id as expected_report_id,
    dpm.created_by as materialized_by
  from dovant_deadline_ids scope
  join public.site_deadlines dl on dl.id = scope.id
  join public.document_proposal_materialization dpm
    on dpm.target_entity_type = 'site_deadline'
   and dpm.target_entity_id = dl.id
  join public.document_extraction_proposal dep on dep.id = dpm.proposal_id
  join public.site_reports sr on sr.extraction_run_id = dep.extraction_run_id
)
select
  id,
  source_proposal_id,
  source_label,
  source_payload,
  jsonb_build_object(
    'status', status,
    'due_date', due_date,
    'report_id', report_id,
    'created_from', created_from,
    'cancel_reason', cancel_reason
  ) as before,
  jsonb_build_object(
    'status', 'cancelled',
    'due_date', null,
    'report_id', expected_report_id,
    'created_from', 'historical_import',
    'cancel_reason', 'bad_extraction',
    'cancelled_by', coalesce(materialized_by, created_by),
    'cancel_comment', 'P0 : objet documentaire planifié matérialisé à tort comme échéance par la régression 338'
  ) as proposed_after
from source
order by id;

-- Préconditions obligatoires avant une future écriture :
-- 1. exactement six lignes ;
-- 2. chacune possède une proposition et un site_report source uniques ;
-- 3. aucune n'est déjà done/cancelled/superseded ;
-- 4. aucune conversion vers site_planning_item dans ce lot.
