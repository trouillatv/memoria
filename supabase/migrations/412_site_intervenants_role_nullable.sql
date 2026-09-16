-- 412 — P0-INT-4 : le rôle chantier devient facultatif (GO Vincent 2026-09-16, option a).
--
-- Doctrine : identifier QUI (acteur/entreprise) doit être possible sans encore
-- savoir QUEL rôle il tient. La mig 320 avait déjà rendu company_id nullable
-- pour représenter « rôle seul » ; on complète symétriquement l'autre sens.
--
-- Les TROIS états valides deviennent :
--   role connu    · identité connue   → casting complet
--   role NULL     · identité connue   → « rôle à préciser » (ce lot)
--   role connu    · identité NULL     → rôle seul, déjà légal depuis la 320
--
-- Aucune ligne totalement vide (ni rôle, ni entreprise, ni contact) : c'est
-- imposé par une contrainte CHECK explicite, pas par une convention de code.
--
-- Aucune valeur artificielle n'est stockée dans role — le NULL réel est la
-- donnée. Le sentinel ci-dessous vit UNIQUEMENT dans l'expression d'index,
-- jamais dans une ligne.

-- 1. Le rôle seul devient optionnel : role nullable.
alter table public.site_intervenants
  alter column role drop not null;

comment on column public.site_intervenants.role is
  'Rôle chantier (MOA/MOE/BET/...), facultatif depuis la mig 412 — NULL = identité connue, rôle pas encore précisé. Jamais de chaîne vide ni de valeur technique type AUTRE.';

-- 2. Empêcher la ligne complètement vide (ni rôle, ni entreprise, ni contact).
alter table public.site_intervenants
  add constraint site_intervenants_not_fully_empty
  check (role is not null or company_id is not null or main_contact_id is not null);

-- 3. L'index actif (mig 320) coalesçait déjà company_id/main_contact_id vers un
--    sentinel interne à l'index pour neutraliser la règle Postgres « chaque NULL
--    est distinct ». On applique le même principe à role, sinon deux lignes
--    « même entreprise, rôle inconnu » ne seraient jamais bloquées en doublon.
drop index if exists public.site_intervenants_active_identity_uniq;

create unique index if not exists site_intervenants_active_identity_uniq
  on public.site_intervenants (
    site_id,
    coalesce(role,             '00000000-0000-0000-0000-000000000000'),
    coalesce(company_id,       '00000000-0000-0000-0000-000000000000'),
    coalesce(main_contact_id,  '00000000-0000-0000-0000-000000000000')
  )
  where effective_to is null;
