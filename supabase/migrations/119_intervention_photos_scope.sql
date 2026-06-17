-- =============================================================================
-- 119 — Sprint 3.5 : ALIMENTATION des scopes (rattachement du contenu terrain).
--
-- Le terrain mobile (/m/site) dépose photos + anomalies au niveau du SITE
-- (scope_id NULL). Pour que les nœuds de mémoire soient nourris — et que la
-- recherche scopée (S4) ait un corpus fiable — il faut pouvoir rattacher ce
-- contenu à un sous-périmètre. S3.5 = rattachement ASSISTÉ (IA propose / humain
-- valide), JAMAIS de friction ajoutée au dépôt mobile.
--
-- Ici : scope_id sur intervention_photos (les actions/anomalies l'ont déjà,
-- mig 117/118). Non destructif : nullable, on delete set null (supprimer un
-- scope dé-rattache, ne supprime jamais la photo). Calque exact de 117/118.
-- =============================================================================

alter table public.intervention_photos
  add column if not exists scope_id uuid references public.memory_scopes(id) on delete set null;

create index if not exists idx_intervention_photos_scope
  on public.intervention_photos(scope_id) where scope_id is not null;
