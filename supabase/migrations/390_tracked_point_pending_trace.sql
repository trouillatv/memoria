-- Migration 390 : tracked_point_pending_trace (Phase 6D.0)
--
-- GO explicite de Vincent après clôture 6C.1 (149/149 CBO exposés, F8 réconcilié par
-- IDs réels). Constat 6C.1 : sur le corpus 5E (RUS), 156 PENDING_TRACKABILITY et
-- 277 RESOLUTION_WITHOUT_KNOWN_PROBLEM sans candidate_point_id sont identifiés par
-- l'audit mais n'ont aujourd'hui AUCUNE table durable — seuls Point (mig 388),
-- tracked_point_member (mig 388) et tracked_point_identity_candidate (mig 389) le
-- sont. Doctrine réaffirmée par Vincent : « chaque trace utile doit avoir soit un
-- Point, soit une raison persistée expliquant pourquoi elle n'en a pas encore. »
-- Migration additive uniquement. Zéro donnée historique écrite ici (Phase 6D.0 =
-- schéma + tests d'isolation seulement ; le remplissage réel vient avec 6D.1 BUILD
-- INITIAL SAFE, sur GO séparé).
--
-- Distinction de vocabulaire, volontairement non fusionnée avec la table sœur :
--   tracked_point_identity_candidate = « je pense que cette trace appartient à
--     CE Point » (candidat à un rattachement précis, cf. mig 389).
--   tracked_point_pending_trace      = « cette trace mérite encore un traitement,
--     mais je ne connais pas son Point » (aucune cible à l'origine).
-- Une pending_trace peut plus tard se résoudre vers un Point identifié — mais
-- seulement par le mécanisme EXISTANT (tracked_point_member HARD, mig 388), jamais
-- par cette table elle-même. target_point_id ici est un pointeur d'AUDIT (« c'est
-- ce Point qui a finalement absorbé cette trace »), pas un mécanisme d'adhésion :
-- aucun réducteur, aucune projection (tracked-point-read-model.ts) ne lit cette
-- table — le read-model du Point reste exactement le contrat 6B/6C (cbo members +
-- tracked_point_member HARD + événements documentaires), inchangé par cette
-- migration.

CREATE TABLE public.tracked_point_pending_trace (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- Même convention que tracked_point_member.subject_thread_id / tracked_point_
  -- identity_candidate.subject_thread_id (mig 388/389) : UUID libre, sans table
  -- dédiée (le moteur lexical n'a jamais matérialisé de table `subject_thread`).
  source_thread_id    UUID        NOT NULL,
  -- Peuplé quand la trace pointe vers une proposition d'extraction précise
  -- (typiquement RESOLUTION_WITHOUT_KNOWN_PROBLEM) ; NULL quand la trace est une
  -- observation au niveau du thread entier (typiquement TRACKABILITY_UNDETERMINED).
  source_proposal_id  UUID,
  -- Petit ensemble fermé, miroir des deux issues Phase 5E qui n'avaient encore
  -- aucune table (P0-1G/5E : PENDING_TRACKABILITY, RESOLUTION_WITHOUT_KNOWN_PROBLEM
  -- sans candidate_point_id). Extension additive uniquement si un nouveau cas de
  -- trace-sans-Point apparaît — jamais de réaffectation d'une valeur existante.
  kind                TEXT        NOT NULL
                         CHECK (kind IN ('TRACKABILITY_UNDETERMINED', 'RESOLUTION_WITHOUT_KNOWN_PROBLEM')),
  reason              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'resolved', 'dismissed')),
  -- Pointeur d'audit seulement (cf. commentaire de tête) : posé UNIQUEMENT quand le
  -- cas se résout vers un Point identifié — jamais pendant l'état pending, jamais
  -- pour un dismissed (un dismissed est une décision humaine « ne deviendra jamais
  -- un Point », pas une identité trouvée).
  target_point_id     UUID        REFERENCES public.tracked_point(id) ON DELETE SET NULL,
  resolved_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Une résolution (resolved/dismissed) est toujours datée — jamais silencieuse
  -- (même garantie que tracked_point_identity_candidate_resolved_consistency).
  CONSTRAINT tracked_point_pending_trace_resolved_consistency
    CHECK (status = 'pending' OR resolved_at IS NOT NULL),
  -- target_point_id posé si et seulement si status='resolved' (jamais pending,
  -- jamais dismissed) — traduit littéralement « target Point facultatif seulement
  -- lorsque le cas est ultérieurement résolu ».
  CONSTRAINT tracked_point_pending_trace_target_consistency
    CHECK ((target_point_id IS NOT NULL) = (status = 'resolved'))
);

-- Idempotence : au plus une trace PENDING active pour un même (thread, kind,
-- proposition). COALESCE nécessaire car deux NULL ne s'unifient jamais sous un
-- index unique Postgres ordinaire — sans ça, deux TRACKABILITY_UNDETERMINED
-- (source_proposal_id toujours NULL) sur le même thread pourraient dupliquer
-- silencieusement à chaque rejeu du futur writer 6D.1.
CREATE UNIQUE INDEX tracked_point_pending_trace_active_uidx
  ON public.tracked_point_pending_trace (
    source_thread_id,
    kind,
    COALESCE(source_proposal_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'pending';

CREATE INDEX ON public.tracked_point_pending_trace (site_id, status);
CREATE INDEX ON public.tracked_point_pending_trace (source_thread_id);
CREATE INDEX ON public.tracked_point_pending_trace (target_point_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Même pattern que mig 388/389 : lecture org-scopée, écriture réservée au
-- service_role (aucun écrivain applicatif câblé en Phase 6D.0 — le premier
-- écrivain réel est 6D.1, sur GO séparé).

ALTER TABLE public.tracked_point_pending_trace ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point_pending_trace"
  ON public.tracked_point_pending_trace FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages tracked_point_pending_trace"
  ON public.tracked_point_pending_trace FOR ALL
  USING (auth.role() = 'service_role');
