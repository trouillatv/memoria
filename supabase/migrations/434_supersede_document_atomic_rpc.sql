-- 434 — Neutralisation atomique d'une version remplacée (P0-1B2 revue
-- FIX_REQUIRED, Vincent 2026-09-24, correction 2).
--
-- Constat : markDocumentSuperseded() passait status='superseded' PUIS
-- supprimait knowledge_chunks (irréversible) PUIS basculait
-- site_reading_candidates en 'stale'. Si l'étape des candidates échouait, le
-- statut était bien restauré à 'active' (compensation applicative), mais les
-- knowledge_chunks avaient déjà été supprimés avant cette restauration — la
-- version "restaurée" active perdait alors définitivement sa connaissance
-- indexée. Exactement l'état partiel que la compensation devait empêcher.
--
-- Une compensation applicative (try/catch + revert) ne peut jamais couvrir ce
-- cas : le DELETE sur knowledge_chunks n'est pas annulable une fois exécuté
-- hors transaction. Seule une transaction SQL unique garantit qu'aucune
-- étape n'est visible si une étape suivante échoue.
--
-- fn_supersede_document(document_id) exécute donc, dans UNE seule fonction
-- (donc une seule transaction implicite Postgres) :
--   1. bascule des résonances site_reading_candidates concernées en 'stale' ;
--   2. suppression des knowledge_chunks du document ;
--   3. passage du document à status='superseded'.
-- Si une étape échoue (exception), Postgres annule automatiquement TOUTES
-- les étapes précédentes de cette fonction : le document reste dans l'état
-- exploitable qu'il avait avant l'appel (jamais de superseded qui fuite,
-- jamais de chunks perdus pour un document resté actif).
--
-- Additif : aucune fonction existante modifiée, aucune colonne/contrainte
-- retirée.

create or replace function public.fn_supersede_document(p_document_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'fn_supersede_document: document % introuvable', p_document_id;
  end if;

  -- Filtre sur source_ids[0].id : même condition que l'ancien filtre côté JS
  -- (PostgREST ne permet pas un filtre direct sur l'élément 0 d'un jsonb array).
  update public.site_reading_candidates
    set status = 'stale'
    where algorithm_version like 'b%_doc_%'
      and status = 'active'
      and (source_ids->0->>'id') = p_document_id::text;

  delete from public.knowledge_chunks
    where source_domain = 'document' and source_id = p_document_id;

  update public.documents
    set status = 'superseded', updated_at = now()
    where id = p_document_id;
end $$;

-- Cette fonction mute des données transverses (résonances, connaissance
-- indexée, statut documentaire) sans revérifier l'organisation/le chantier :
-- cette vérification vit dans les Server Actions appelantes (requireOrganizationRole),
-- pas dans le RPC. Elle ne doit donc être exécutable que par le serveur via
-- createAdminClient() (service_role), jamais directement depuis un client
-- authenticated/anon.
revoke all on function public.fn_supersede_document(uuid) from public;
revoke all on function public.fn_supersede_document(uuid) from anon;
revoke all on function public.fn_supersede_document(uuid) from authenticated;
grant execute on function public.fn_supersede_document(uuid) to service_role;
