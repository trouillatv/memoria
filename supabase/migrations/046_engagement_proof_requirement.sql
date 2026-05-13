-- Migration 046 — Exigences de preuve par engagement (Phase 4.1).
--
-- Permet au manager de déclarer, lors de la curation d'un engagement,
-- quelle preuve est attendue pour le considérer comme correctement exécuté :
--   - 'photo' : au moins 1 photo associée à l'intervention
--   - 'anomaly_documented' : pas d'anomalie OU anomalie clôturée
--   - 'none' : exécution suffit (default, équivalent au comportement actuel)
--
-- Cette exigence est descendante : elle dit ce qui suffit, pas ce qui est
-- imposé à l'agent. Le calcul de couverture (Phase 4.2) en dérive le « niveau
-- de confiance du dossier » (Phase 4.3).

alter table public.engagements
  add column if not exists proof_requirement text not null default 'none'
  check (proof_requirement in ('photo', 'anomaly_documented', 'none'));

comment on column public.engagements.proof_requirement is
  'Niveau de preuve attendu pour considérer l''engagement comme exécuté de façon défendable. photo = >=1 photo. anomaly_documented = pas d''anomalie ouverte. none = exécution suffit.';
