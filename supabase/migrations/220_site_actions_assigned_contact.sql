-- =============================================================================
-- 220 — Le responsable STRUCTUREL d'une action = une PERSONNE (P2, Slice 1).
--
-- Jusqu'ici `site_actions.assigned_to` est du TEXTE LIBRE (« Papa », « Sotrap »,
-- un code de rôle…) : jamais une preuve d'attribution à une personne. Le suivi
-- « qu'attend-on de X ? » exige une relation structurelle. On l'ajoute :
--   site_actions.assigned_contact_id -> company_contacts(id)
-- L'identité STABLE de la personne (le contact), PAS sa ligne de casting
-- (contextuelle, mutable) : une action doit continuer à désigner Vincent même
-- si son rôle change ou s'il quitte le casting.
--
-- ADDITIF, nullable, SANS backfill : `assigned_to` reste tel quel (trace
-- historique), aucune valeur texte n'est convertie en personne. L'attribution
-- explicite (humaine) viendra en Slice 2.
--
-- ON DELETE SET NULL : jamais de cascade destructrice — si le contact disparaît,
-- l'action SURVIT et perd seulement le lien (`assigned_to` reste). Cohérent avec
-- `site_decisions.decisionnaire_contact_id` (mig 138).
-- =============================================================================

alter table public.site_actions
  add column if not exists assigned_contact_id uuid
    references public.company_contacts(id) on delete set null;

-- Lecture par personne : « actions de ce contact » (tous chantiers) ET « … sur
-- CE chantier ». Le contact en 1ʳᵉ colonne sert la requête contact-seul ; site_id
-- en 2ᵉ raffine par chantier (égalités). Les lectures par site_id seul sont déjà
-- couvertes (sa_site_status_idx, sa_corps_idx, mig 099) — pas d'index redondant.
create index if not exists sa_assigned_contact_idx
  on public.site_actions (assigned_contact_id, site_id)
  where assigned_contact_id is not null;

-- INVARIANT TENANT garanti par la BASE (pas seulement l'appli) : site_actions est
-- écrite via service_role (la RLS ne protège pas d'une future action mal câblée).
-- Le contact assigné doit appartenir à la MÊME organisation que le chantier.
-- On NE vérifie PAS l'appartenance au casting actif : le casting est mutable ;
-- une action historique conserve son responsable même si la personne en est
-- retirée. Le sélecteur (Slice 2) sera plus strict ; la base garantit l'invariant.
--
-- `search_path = ''` + noms pleinement qualifiés : pas de détournement de path,
-- pas de dépendance à une donnée fournie par le client (pattern mig 219).
create or replace function public.check_site_action_contact_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_site_org        uuid;
  v_contact_org     uuid;
  v_contact_deleted timestamptz;
begin
  -- Pas de responsable : rien à valider.
  if new.assigned_contact_id is null then
    return new;
  end if;

  -- Un UPDATE qui ne (RE)POSE PAS le lien ne doit JAMAIS invalider un historique :
  -- le contact a pu être archivé ou retiré du casting depuis l'attribution. On ne
  -- valide donc qu'à l'INSERT ou quand assigned_contact_id change réellement.
  if tg_op = 'UPDATE' and new.assigned_contact_id is not distinct from old.assigned_contact_id then
    return new;
  end if;

  select organization_id into v_site_org
    from public.sites where id = new.site_id;
  select organization_id, deleted_at into v_contact_org, v_contact_deleted
    from public.company_contacts where id = new.assigned_contact_id;

  if v_contact_org is null or v_site_org is null or v_contact_org is distinct from v_site_org then
    raise exception 'site_actions: le responsable (%) doit appartenir a la meme organisation que le chantier', new.assigned_contact_id;
  end if;

  -- Nouvelle attribution vers un contact archivé : refusée. (Un contact archivé
  -- APRÈS coup ne casse rien : ce chemin ne s'exécute que quand le lien est posé.)
  if v_contact_deleted is not null then
    raise exception 'site_actions: ce contact est archive, il ne peut pas recevoir de nouvelle attribution';
  end if;

  return new;
end $$;

drop trigger if exists trg_site_actions_contact_org on public.site_actions;
create trigger trg_site_actions_contact_org
  before insert or update on public.site_actions
  for each row execute function public.check_site_action_contact_org();
