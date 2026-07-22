-- ============================================================
-- 233 — M1 : un compte, plusieurs appartenances
-- ============================================================
-- AGP et SERVINOR sont deux ENTITÉS JURIDIQUES distinctes (décision produit,
-- 2026-07-22). Guillaume travaille pour les deux et doit garder un seul compte,
-- un seul email, une seule session.
--
-- ── CE QUE LE MODÈLE FAISAIT ────────────────────────────────────────────────
--
-- `users.organization_id` : UNE colonne, donc UNE organisation (mig 089). Et
-- `assignUserToOrg()` fait un UPDATE de cette colonne — c'est un DÉPLACEMENT,
-- pas un ajout. Inviter Guillaume dans SERVINOR l'aurait retiré d'AGP, en
-- silence. Le rôle, lui, vit sur `users.role` : global, donc impossible d'être
-- administrateur ici et conducteur là.
--
-- ── CE QUE CETTE TABLE ÉTABLIT ──────────────────────────────────────────────
--
-- L'appartenance devient une LIGNE, pas une colonne. Le rôle vit sur
-- l'appartenance, parce que c'est de l'appartenance qu'il dépend : « Guillaume
-- est administrateur » n'a aucun sens hors d'une organisation.
--
-- ── CE QUI N'EST PAS FAIT ICI, DÉLIBÉRÉMENT ────────────────────────────────
--
-- `users.organization_id` et `users.role` SURVIVENT, et restent la source de
-- vérité des 193 appels à `getOrgId()` et des contrôles de rôle existants. Les
-- supprimer maintenant casserait tout le dépôt d'un coup.
--
--   · qui ÉCRIT l'ancien modèle  : `assignUserToOrg`, `updateUserProfileAsAdmin`
--   · qui LIT l'ancien modèle    : `getOrgId()` (193 appels), les gardes de rôle
--   · quand il disparaîtra       : quand M2/M3 auront migré ces lecteurs
--   · l'invariant qui empêche la divergence : pour un utilisateur MONO-
--     organisation, l'appartenance et la colonne doivent coïncider. Vérifié par
--     un test de doctrine, et garanti par le fait que M1 écrit les deux.
--
-- Pour un utilisateur MULTI-organisations, la colonne `users.organization_id`
-- devient une simple ORGANISATION PAR DÉFAUT et cesse de faire autorité :
-- `getOrgId()` refuse alors de répondre plutôt que de choisir. Voir
-- `lib/auth/memberships.ts`.
--
-- Additive et idempotente. Aucun compte ne perd son accès.

create table if not exists public.organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id)         on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Le rôle est porté par L'APPARTENANCE. Même vocabulaire fermé que le profil
  -- (`user_role`, mig 001) : deux échelles de rôles seraient deux doctrines.
  role            user_role   not null,
  -- Une appartenance suspendue ne donne AUCUN accès, mais garde son historique.
  -- On ne supprime pas une appartenance : on la ferme, comme un intervenant de
  -- chantier (mig 137). Qui a eu accès, et quand, reste démontrable.
  status          text        not null default 'active'
                  check (status in ('active', 'suspended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- L'INVARIANT CENTRAL : on n'appartient qu'une fois à la même organisation.
-- C'est lui qui rend les invitations idempotentes — réinviter une adresse déjà
-- membre ne peut pas créer de doublon, même en cas d'appel concurrent.
create unique index if not exists organization_memberships_user_org_unique
  on public.organization_memberships(user_id, organization_id);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships(user_id) where status = 'active';
create index if not exists organization_memberships_org_idx
  on public.organization_memberships(organization_id) where status = 'active';

-- ── REPRISE DE L'EXISTANT ───────────────────────────────────────────────────
-- Déterministe et idempotente : chaque utilisateur rattaché à une organisation
-- devient membre actif de celle-ci, avec le rôle qu'il portait. Relancer la
-- migration ne crée rien de plus (ON CONFLICT), et n'écrase pas un rôle qu'un
-- administrateur aurait modifié depuis.
--
-- Les utilisateurs SANS organisation (1 compte constaté) ne reçoivent aucune
-- appartenance : leur donner une organisation arbitraire serait leur ouvrir un
-- accès que personne ne leur a accordé.
insert into public.organization_memberships (user_id, organization_id, role, status)
select u.id, u.organization_id, u.role, 'active'
from public.users u
where u.organization_id is not null
  and u.deleted_at is null
on conflict (user_id, organization_id) do nothing;

alter table public.organization_memberships enable row level security;

-- On lit ses PROPRES appartenances, et rien d'autre. Le service-role contourne
-- la RLS (c'est le mode d'accès du dépôt) : le cloisonnement réel reste
-- applicatif, dans `lib/auth/memberships.ts`. Cette politique est un second
-- filet, pas le filet principal.
drop policy if exists "read own memberships" on public.organization_memberships;
create policy "read own memberships"
  on public.organization_memberships
  for select
  using (user_id = auth.uid());

comment on table public.organization_memberships is
  'M1 — appartenance d''un compte à une organisation, avec son rôle propre. Un humain = un compte = N appartenances. Le rôle vit ICI, pas sur le profil : « administrateur » n''a pas de sens hors d''une organisation.';
