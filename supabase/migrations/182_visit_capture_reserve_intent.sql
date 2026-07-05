-- 182 — Captures de visite : ajout de l'intention « réserve » au tri terrain.
--
-- Refonte de l'écran de traitement (photo par photo, 4 tags métier) :
--   📚 Mémoire      → status='kept', triage_intent=null   (preuve, aucune suite)
--   👀 À surveiller → status='kept', triage_intent='follow'
--   ⚠️ Réserve      → status='kept', triage_intent='reserve'  ← NOUVEAU
--   ✅ Action       → status='kept', triage_intent='action'
--
-- Règle produit : LE TRI NE SUPPRIME JAMAIS. Les 4 tags gardent la capture
-- (status='kept') ; seule une suppression VOLONTAIRE (photo floue) pose
-- status='discarded'. La MATÉRIALISATION (transformer une réserve/action en
-- vrai objet avec responsable/échéance) se fait au BUREAU. « Sur le terrain on
-- observe, au bureau on organise. »

alter table public.visit_capture
  drop constraint if exists visit_capture_triage_intent_check;

alter table public.visit_capture
  add constraint visit_capture_triage_intent_check
    check (triage_intent is null or triage_intent in ('action', 'follow', 'reserve'));

comment on column public.visit_capture.triage_intent is
  'Suite décidée au traitement des captures (mig 168, étendu mig 182) : action | follow | reserve | null(=mémoire/preuve). La décision est ENREGISTRÉE ; la matérialisation (action/réserve, lien sujet, projection CR) se fait au bureau. Vocabulaire métier only.';
