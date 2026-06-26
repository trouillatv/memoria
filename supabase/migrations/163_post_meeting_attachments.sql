-- 163 — Mémoire enrichissable après réunion (Vincent 2026-06-26)
--
-- Doctrine : « le PV est une VERSION (figée), la mémoire est VIVANTE ». Une
-- réunion terminée n'est pas verrouillée : on peut y ajouter des PIÈCES de
-- contexte (photo prise après, capture, fichier reçu après coup…). On TRACE que
-- c'est post-réunion — jamais en silence, jamais comme un reproche.
--
-- A (cette mig) = site_report_attachments : pièces LÉGÈRES de contexte.
-- B (mig 164)   = documents/document_links : vrais documents métier durables.

alter table public.site_report_attachments
  add column if not exists uploaded_after_meeting boolean not null default false,
  add column if not exists added_by uuid references public.users(id) on delete set null,
  add column if not exists added_at timestamptz;

comment on column public.site_report_attachments.uploaded_after_meeting is
  'Pièce ajoutée APRÈS la réunion (mig 163). Le PV figé reste inchangé ; la mémoire s''enrichit.';
