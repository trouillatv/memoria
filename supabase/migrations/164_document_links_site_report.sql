-- 164 — Documents mémoire rattachés à une RÉUNION (Vincent 2026-06-26)
--
-- B du couple A+B : un vrai document métier reçu après coup (DOE, plan, marché,
-- avenant, PV signé externe, rapport bureau de contrôle, attestation…) ne doit
-- pas rester une pièce jointe légère — il entre dans la mémoire DOCUMENTAIRE,
-- lié à la réunion. On autorise donc `target_type = 'site_report'` sur les liens.
-- (Les PJ légères de contexte restent dans site_report_attachments, mig 163.)

alter table public.document_links drop constraint if exists document_links_target_type_check;
alter table public.document_links add constraint document_links_target_type_check
  check (target_type in (
    'contract', 'site', 'tender', 'client', 'intervention', 'team', 'tenant',
    'reserve', 'subject', 'obligation', 'site_report'));
