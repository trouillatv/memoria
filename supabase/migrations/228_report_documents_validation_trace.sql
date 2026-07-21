-- =============================================================================
-- 228 — QUI A FINALISÉ, ET QUAND. Idem pour la réouverture.
--
-- Un compte-rendu qui passe de brouillon à finalisé engage quelqu'un. Le statut
-- seul ne dit ni qui, ni quand : il faut pouvoir répondre « c'est Guillaume, le
-- 21 juillet » six mois plus tard, quand la question se pose vraiment.
--
-- Quatre colonnes NULLABLES, rien d'autre. Le VERSIONNEMENT est écarté
-- volontairement (Vincent, 2026-07-21) : plusieurs versions documentaires
-- ouvriraient trop tôt des questions sans réponse — laquelle est la référence,
-- laquelle a été envoyée, laquelle a produit les objets du chantier. Une seule
-- vérité, et un geste explicite pour la rouvrir.
--
-- `reopened_at/by` ne gardent que la DERNIÈRE réouverture, assumé : l'historique
-- complet vit dans `activity_logs`, qui existe déjà. On n'ajoute pas un second
-- moteur d'audit pour ça.
--
-- Le PV de réunion partage cette table : colonnes nullables, comportement
-- inchangé pour lui.
-- =============================================================================

alter table public.report_documents
  add column if not exists validated_at  timestamptz,
  add column if not exists validated_by  uuid references public.users(id) on delete set null,
  add column if not exists reopened_at   timestamptz,
  add column if not exists reopened_by   uuid references public.users(id) on delete set null;

comment on column public.report_documents.validated_at is
  'Passage brouillon → finalisé. NULL tant que le document n''a jamais été finalisé.';
comment on column public.report_documents.reopened_at is
  'Dernière réouverture (finalisé → brouillon). L''historique complet vit dans activity_logs.';
