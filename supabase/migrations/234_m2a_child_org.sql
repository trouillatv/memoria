-- ============================================================
-- 234 — M2A : propriété structurelle du chantier
-- ============================================================
-- Les objets enfants du chantier (site_actions, site_decisions,
-- site_intervenants, site_action_events) ne portaient pas `organization_id` :
-- toute garde de cloisonnement devait passer par une jointure vers le site.
--
-- ── DOCTRINE : `site_id` EST LA SOURCE, `organization_id` EST UN CACHE ──────
--
-- L'application fournit `site_id` ; la base DÉRIVE `organization_id`. Elle ne
-- se saisit jamais librement. Deux garde-fous complémentaires :
--
--   · TRIGGER (ergonomie) — recalcule toujours l'org depuis le site, à l'INSERT
--     (et l'UPDATE là où c'est permis), en IGNORANT toute valeur fournie ;
--   · FK COMPOSITE (invariant déclaratif) — (site_id, organization_id) doit
--     désigner le même chantier. Protège même une écriture SQL directe, un
--     script de maintenance ou une régression future.
--
-- L'un pose la bonne valeur, l'autre interdit qu'une divergence survive.
--
-- Audit préalable (2026-07-22) : les 4 tables ont `site_id NOT NULL`, 96 lignes
-- au total, ZÉRO orphelin, ZÉRO site sans organisation. Le backfill est donc
-- déterministe et complet.
--
-- append-only : `site_action_events` refuse UPDATE/DELETE (mig 221). Son
-- trigger d'héritage est donc BEFORE INSERT SEULEMENT — un BEFORE UPDATE ne se
-- déclencherait jamais et brouillerait le contrat. Sa FK composite est SANS
-- `on update cascade` : un cascade heurterait le trigger append-only. Changer
-- l'organisation d'un chantier existant n'appartient à aucun flux produit ; la
-- FK NO ACTION le bloque tant qu'il porte un historique — comportement voulu.
--
-- FK simples conservées : chaque table garde sa FK `site_id → sites(id) on
-- delete restrict` (existence + suppression). La composite s'y AJOUTE pour la
-- cohérence de l'organisation. Deux contrats complémentaires, non
-- contradictoires : l'un gère la vie du lien, l'autre la vérité de l'org.

-- ── 1. ASSERTIONS PRÉALABLES ────────────────────────────────────────────────
-- Rien ne commence si un chantier est sans organisation : les enfants ne
-- doivent pas devenir plus stricts que leur parent.
do $$
begin
  if exists (select 1 from public.sites where organization_id is null) then
    raise exception 'M2A impossible : au moins un chantier (sites) est sans organization_id';
  end if;
end $$;

-- ── 2. sites.organization_id NON NULLABLE ───────────────────────────────────
-- La colonne était nullable « en théorie » (mig 089) alors qu'aucun chantier
-- n'est sans org. On aligne le contrat sur la réalité.
alter table public.sites
  alter column organization_id set not null;

-- ── 3. UNIQUE (id, organization_id) sur sites ───────────────────────────────
-- Support des FK composites : `id` est déjà PK (donc le couple est unique),
-- mais Postgres exige une contrainte UNIQUE explicite sur les colonnes
-- référencées.
alter table public.sites
  add constraint sites_id_org_unique unique (id, organization_id);

-- ── 4. AJOUT NULLABLE des 4 colonnes (le temps du backfill) ─────────────────
alter table public.site_actions        add column if not exists organization_id uuid references public.organizations(id);
alter table public.site_decisions      add column if not exists organization_id uuid references public.organizations(id);
alter table public.site_intervenants   add column if not exists organization_id uuid references public.organizations(id);
alter table public.site_action_events  add column if not exists organization_id uuid references public.organizations(id);

-- ── 5. BACKFILL déterministe depuis le chantier ─────────────────────────────
update public.site_actions       c set organization_id = s.organization_id from public.sites s where c.site_id = s.id and c.organization_id is null;
update public.site_decisions     c set organization_id = s.organization_id from public.sites s where c.site_id = s.id and c.organization_id is null;
update public.site_intervenants  c set organization_id = s.organization_id from public.sites s where c.site_id = s.id and c.organization_id is null;
-- site_action_events est append-only : son trigger `trg_action_event_immutable`
-- refuse tout UPDATE de ligne, y compris ce backfill de maintenance. On le
-- suspend LE TEMPS DU SEUL BACKFILL, dans la même transaction, puis on le
-- rétablit. Aucune fenêtre applicative : la migration est atomique.
alter table public.site_action_events disable trigger trg_action_event_immutable;
update public.site_action_events c set organization_id = s.organization_id from public.sites s where c.site_id = s.id and c.organization_id is null;
alter table public.site_action_events enable trigger trg_action_event_immutable;

-- ── 6. CONTRÔLE : zéro NULL, zéro divergence AVANT de verrouiller ───────────
do $$
declare v_bad int;
begin
  select
    (select count(*) from public.site_actions       where organization_id is null)
  + (select count(*) from public.site_decisions     where organization_id is null)
  + (select count(*) from public.site_intervenants  where organization_id is null)
  + (select count(*) from public.site_action_events where organization_id is null)
  into v_bad;
  if v_bad > 0 then raise exception 'M2A : % ligne(s) enfant sans organization_id après backfill', v_bad; end if;

  select
    (select count(*) from public.site_actions       c join public.sites s on s.id=c.site_id where c.organization_id is distinct from s.organization_id)
  + (select count(*) from public.site_decisions     c join public.sites s on s.id=c.site_id where c.organization_id is distinct from s.organization_id)
  + (select count(*) from public.site_intervenants  c join public.sites s on s.id=c.site_id where c.organization_id is distinct from s.organization_id)
  + (select count(*) from public.site_action_events c join public.sites s on s.id=c.site_id where c.organization_id is distinct from s.organization_id)
  into v_bad;
  if v_bad > 0 then raise exception 'M2A : % ligne(s) enfant divergente(s) du chantier', v_bad; end if;
end $$;

-- ── 7. PASSAGE NOT NULL ─────────────────────────────────────────────────────
alter table public.site_actions        alter column organization_id set not null;
alter table public.site_decisions      alter column organization_id set not null;
alter table public.site_intervenants   alter column organization_id set not null;
alter table public.site_action_events  alter column organization_id set not null;

-- ── 8. FONCTION TRIGGER PARTAGÉE — force l'org depuis le site ────────────────
-- `security definer` : lit `sites` quel que soit le rôle inséreur (le service
-- role comme un tenant). Recalcule TOUJOURS depuis `new.site_id`, ignore toute
-- valeur fournie. Lève si le site est absent ou sans org (défense en
-- profondeur — l'état ne devrait pas exister après l'étape 2).
create or replace function public.force_site_child_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.sites where id = new.site_id;
  if v_org is null then
    raise exception 'Site % absent ou sans organisation (table %)', new.site_id, tg_table_name;
  end if;
  new.organization_id := v_org;
  return new;
end $$;

-- ── 9. TRIGGERS ─────────────────────────────────────────────────────────────
-- Nom en `trg_force_org` : s'exécute APRÈS les triggers de cohérence existants
-- (ex. `trg_action_event_site`, préfixe `a`), une fois `site_id` validé.
drop trigger if exists trg_force_org on public.site_actions;
create trigger trg_force_org before insert or update on public.site_actions
  for each row execute function public.force_site_child_organization();

drop trigger if exists trg_force_org on public.site_decisions;
create trigger trg_force_org before insert or update on public.site_decisions
  for each row execute function public.force_site_child_organization();

drop trigger if exists trg_force_org on public.site_intervenants;
create trigger trg_force_org before insert or update on public.site_intervenants
  for each row execute function public.force_site_child_organization();

-- site_action_events : append-only → BEFORE INSERT UNIQUEMENT (coexiste avec
-- trg_action_event_immutable qui refuse déjà UPDATE/DELETE).
drop trigger if exists trg_force_org on public.site_action_events;
create trigger trg_force_org before insert on public.site_action_events
  for each row execute function public.force_site_child_organization();

-- ── 10. FK COMPOSITES — (site_id, organization_id) doit désigner le même site ─
alter table public.site_actions
  add constraint site_actions_site_org_fk       foreign key (site_id, organization_id) references public.sites(id, organization_id);
alter table public.site_decisions
  add constraint site_decisions_site_org_fk     foreign key (site_id, organization_id) references public.sites(id, organization_id);
alter table public.site_intervenants
  add constraint site_intervenants_site_org_fk  foreign key (site_id, organization_id) references public.sites(id, organization_id);
alter table public.site_action_events
  add constraint site_action_events_site_org_fk foreign key (site_id, organization_id) references public.sites(id, organization_id);

-- ── 11. INDEX (perf + futur RLS) ────────────────────────────────────────────
create index if not exists idx_site_actions_org        on public.site_actions(organization_id);
create index if not exists idx_site_decisions_org      on public.site_decisions(organization_id);
create index if not exists idx_site_intervenants_org   on public.site_intervenants(organization_id);
create index if not exists idx_site_action_events_org  on public.site_action_events(organization_id);

comment on function public.force_site_child_organization is
  'M2A — dérive organization_id depuis le chantier (new.site_id), ignore toute valeur fournie. organization_id enfant est un CACHE, jamais une valeur métier libre.';
