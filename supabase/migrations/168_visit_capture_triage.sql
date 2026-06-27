-- 168 — Captures de visite : décision du DÉBRIEF EXPRESS (Vincent 2026-06-27)
--
-- Au débrief express (voiture, 2 min), l'humain ne demande pas « que DEVIENT cette
-- capture ? » mais « est-ce que ça mérite une SUITE ? ». 4 choix V1 SEULEMENT
-- (anti usine à boutons — cf. [[visite-trois-temps]]) :
--   Ignorer          → status='discarded' (réversible, jamais DELETE), aucune suite
--   Garder (trace)   → status='kept',  triage_intent=null
--   Créer une action → status='kept',  triage_intent='action'
--   Suivre ce point  → status='kept',  triage_intent='follow'
--
-- La DÉCISION est enregistrée ici ; la MATÉRIALISATION (créer l'action, lier le
-- sujet, projeter au journal/CR) se fait au BUREAU (« MemorIA prépare les suites » ;
-- au débrief complet on VALIDE, on ne crée pas). Réserve / anomalie / document /
-- compte-rendu NE sont PAS proposés dans la voiture (dérivables plus tard). Le
-- modèle technique (routes, destinations, kept/discarded) reste CACHÉ au métier.

alter table public.visit_capture
  add column if not exists triage_intent text
    check (triage_intent is null or triage_intent in ('action', 'follow'));

comment on column public.visit_capture.triage_intent is
  'Suite décidée au débrief express (mig 168), au-delà de garder/ignorer (status) : action | follow | null(=trace). La décision est ENREGISTRÉE ; la matérialisation (action, lien sujet, projection journal/CR) se fait au bureau. Vocabulaire métier only : le terrain ne voit jamais kept/discarded/destination.';
