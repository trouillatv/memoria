-- ===========================================================
-- Migration 097 — Intervention Access Tokens
--
-- Lien sécurisé contextualisé vers une intervention spécifique.
-- Philosophie : /i/[token] = /h/[token] mais pour une intervention.
--
-- Usage principal : briefing du soir → générer lien → envoyer sous-traitant WhatsApp.
-- Le porteur du token accède à la mission + checklist + peut valider.
-- Sans login. Sans accès au chantier complet.
--
-- Doctrine :
--   - token ≠ lien chantier (pas d'historique, pas de documents, pas d'anomalies)
--   - permissions limitées par défaut : read + checklist + comment + validate
--   - expiration par défaut : 48h (configurable, null = jusqu'à clôture)
--   - révocable immédiatement
--   - validation_by_name : nom libre saisi par le porteur (pas d'auth)
-- ===========================================================

create table public.intervention_tokens (
  id                   uuid primary key default gen_random_uuid(),
  token                text not null,
  intervention_id      uuid not null references public.interventions(id) on delete cascade,

  -- Permissions : ce que le porteur peut faire.
  -- 'read'      = voir mission + checklist (toujours inclus)
  -- 'checklist' = cocher des items (V2 — pas encore implémenté côté UI)
  -- 'comment'   = ajouter un commentaire textuel
  -- 'validate'  = marquer l'intervention comme réalisée
  permissions          text[] not null default array['read', 'comment', 'validate'],

  -- Expiration (null = jusqu'à révocation manuelle ou clôture intervention)
  expires_at           timestamptz,

  -- Contexte de création (pour le manager qui retrouve ses liens)
  created_by           uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  note                 text,        -- ex : "Sous-traitant Lucas / livraison BA13"

  -- Tracking accès silencieux
  accessed_at          timestamptz,
  access_count         integer not null default 0,

  -- Validation par le porteur du token (sans login)
  validated_at         timestamptz,
  validated_by_name    text,        -- nom libre saisi par le porteur
  validation_comment   text,        -- commentaire libre (ex: "3 montants manquants")

  -- Révocation
  revoked_at           timestamptz,
  revoked_by           uuid references public.users(id) on delete set null
);

create unique index on public.intervention_tokens (token);
create index on public.intervention_tokens (intervention_id);
create index on public.intervention_tokens (created_by);

-- RLS : tout l'accès passe par le service role (admin client côté server actions).
-- Aucun accès direct client autorisé — évite l'exposition des tokens.
alter table public.intervention_tokens enable row level security;

create policy "service_role_only" on public.intervention_tokens
  for all to service_role using (true);

-- Fonction utilitaire pour incrémenter access_count atomiquement
-- depuis une server action (évite le read-then-write race condition).
create or replace function public.record_intervention_token_access(p_token text)
returns void language sql security definer as $$
  update public.intervention_tokens
  set
    accessed_at  = now(),
    access_count = access_count + 1
  where token = p_token
    and revoked_at is null;
$$;
