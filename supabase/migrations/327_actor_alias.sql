-- 327 — actor_alias : ENSEIGNER une identité d'acteur existante (P4-B.2).
--
-- (Cadrage Vincent 2026-08-17.) Corrige une mécoupure STT ou une manière de
-- désigner un acteur déjà connu (« Quand je dis Clim Expert, je parle de Clim
-- Expair. » / « Jérôme, c'est Jérôme Martin de BECIB. ») — PAS un apprentissage
-- libre du LLM : assertion utilisateur → proposition structurée → validation
-- humaine → matérialisation déterministe ici.
--
-- Portée : companies ET company_contacts (même problème — résoudre une
-- mention humaine vers une identité d'acteur existante — traité par une seule
-- doctrine, pas une asymétrie organisme/personne). Explicitement HORS
-- périmètre : canonical_subject.aliases (doctrine séparée, sujets suivis) et
-- toute relation acteur↔domaine/rôle (« Clim Expair s'occupe de la
-- climatisation » = RELATION_CLAIM, futur P4-B.3, jamais absorbé ici).
--
-- MemorIA apprend une FORME DE DÉSIGNATION ; elle ne réécrit jamais
-- silencieusement l'identité officielle (company.name / contact.full_name
-- restent intacts — aucun UPDATE ici, jamais).
--
-- Cible XOR (company_id / contact_id), même pattern que
-- canonical_subject_suggestion.source_proposal_id/subject_thread_id
-- (mig 301) : FK réelles, pas de colonne polymorphe type+id.
--
-- Unicité : PAS d'unicité globale (organization_id, alias_norm) — trop forte,
-- elle interdirait un cas normal (deux Jérôme différents dans la même
-- organisation partageant l'alias « Jérôme »). L'ambiguïté doit être
-- représentable, jamais interdite par le schéma (même doctrine que le
-- « cadenas » de P4-A.1) — c'est le RESOLVER applicatif qui, en trouvant deux
-- candidats confirmés, redemande une clarification. L'unicité porte donc sur
-- (organisation, CIBLE, alias), pas sur (organisation, alias) seul.
--
-- alias_nature distingue deux natures qui alimentent TOUTES DEUX le
-- vocabulaire STT et la résolution acteur, mais dont une seule (business_alias)
-- s'affiche comme « autre nom » légitime de l'acteur (fiche, export,
-- recherche) : une transcription_alias est une mécoupure connue, pas une
-- variante métier réelle.
--
-- Provenance double : copilot_proposal_id (idempotence, même mécanique que
-- site_actions.copilot_proposal_id mig 293 — clé générée côté client, pas de
-- FK) + copilot_interaction_id (FK réelle vers copilot_interactions, mig 294)
-- pour que l'Observatoire réponde « Pourquoi MemorIA sait-elle que… ? ».
--
-- Pas de site_id en V1 : un acteur ne change pas d'identité selon le
-- chantier. Un surnom réellement local à un chantier (« le climaticien » sur
-- PETRO uniquement) n'est pas une identité mais une relation contextuelle —
-- P4-B.3, pas actor_alias.

create table if not exists public.actor_alias (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,

  company_id             uuid references public.companies(id) on delete cascade,
  contact_id             uuid references public.company_contacts(id) on delete cascade,

  alias                  text not null,
  alias_norm             text not null,
  alias_nature           text not null,
  status                 text not null default 'proposed',
  source                 text not null,

  copilot_proposal_id    uuid,
  copilot_interaction_id uuid references public.copilot_interactions(id) on delete set null,

  created_by             uuid references public.users(id) on delete set null,
  confirmed_by           uuid references public.users(id) on delete set null,
  confirmed_at           timestamptz,
  revoked_at             timestamptz,

  created_at             timestamptz not null default now()
);

alter table public.actor_alias
  add constraint chk_actor_alias_target_xor check (
    (company_id is not null and contact_id is null)
    or
    (company_id is null and contact_id is not null)
  );

alter table public.actor_alias
  add constraint chk_actor_alias_nature check (
    alias_nature in ('business_alias', 'transcription_alias')
  );

alter table public.actor_alias
  add constraint chk_actor_alias_status check (
    status in ('proposed', 'confirmed', 'rejected', 'revoked')
  );

comment on table public.actor_alias is
  'Alias/identité enseignée pour un acteur existant (company ou company_contact) — P4-B.2, mig 327. Ne renomme jamais company.name/contact.full_name. Ambiguïté (deux acteurs, même alias) autorisée par le schéma, tranchée par le resolver applicatif.';

comment on column public.actor_alias.alias_nature is
  'business_alias = variante métier réelle (affichée comme "autre nom") ; transcription_alias = mécoupure STT connue (jamais affichée comme nom métier). Les deux alimentent vocabulaire STT + résolution acteur.';

comment on column public.actor_alias.copilot_proposal_id is
  'Clé d''idempotence générée côté client à l''affichage du brouillon (même mécanique que site_actions.copilot_proposal_id, mig 293) — pas une FK.';

comment on column public.actor_alias.copilot_interaction_id is
  'Provenance réelle (FK copilot_interactions, mig 294) — répond à "Pourquoi MemorIA sait-elle que X désigne Y ?" dans l''Observatoire.';

-- ── Unicité par CIBLE, pas globale — l'ambiguïté doit rester représentable ──────
-- Deux index partiels distincts (un par type de cible) : un alias confirmé ne
-- peut désigner deux fois la MÊME cible, mais peut légitimement désigner
-- plusieurs cibles différentes (deux "Jérôme" réels) — le resolver demandera
-- alors une clarification, jamais le schéma.

create unique index if not exists actor_alias_company_unique_confirmed
  on public.actor_alias (organization_id, company_id, alias_norm)
  where status = 'confirmed' and company_id is not null;

create unique index if not exists actor_alias_contact_unique_confirmed
  on public.actor_alias (organization_id, contact_id, alias_norm)
  where status = 'confirmed' and contact_id is not null;

-- Idempotence d'écriture (double-clic "Valider"), même pattern que mig 293/295.
create unique index if not exists actor_alias_copilot_proposal_id_key
  on public.actor_alias (copilot_proposal_id)
  where copilot_proposal_id is not null;

-- ── Index de lecture ─────────────────────────────────────────────────────────

create index if not exists actor_alias_org_norm_idx
  on public.actor_alias (organization_id, alias_norm)
  where status = 'confirmed';

create index if not exists actor_alias_company_idx
  on public.actor_alias (company_id) where company_id is not null;

create index if not exists actor_alias_contact_idx
  on public.actor_alias (contact_id) where contact_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.actor_alias enable row level security;

drop policy if exists "actor_alias read" on public.actor_alias;
create policy "actor_alias read" on public.actor_alias
  for select using (organization_id = public.current_user_org_id());
