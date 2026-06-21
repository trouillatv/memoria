-- =============================================================================
-- 143 — VUE SUJET (Vincent 2026-06-21) : le SUJET est l'objet métier central de la
-- mémoire chantier. La table `subjects` (mig 124) relie déjà actions/réserves/
-- décisions-de-CR/documents. Mais nos décisions STRUCTURÉES (site_decisions, mig 136)
-- n'avaient qu'un champ texte libre `sujet`, sans lien vers l'entité subject → elles
-- n'apparaissaient pas dans le fil. On les RELIE.
-- =============================================================================

alter table public.site_decisions
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_site_decisions_subject on public.site_decisions(subject_id);
