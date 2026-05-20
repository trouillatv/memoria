import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  B1_ALGO_ACCESS,
  B1_ALGO_PROCEDURE,
  B1_DOC_TYPES_ACCESS,
  B1_DOC_TYPES_PROCEDURE,
  B1_EXPIRE_DAYS,
  B1_MAX_PER_SITE,
  B1_VISIBILITY_ALLOWED,
  findCommonBigrams,
  frDayMonth,
} from './resonance-matchers'

// =============================================================================
// B1 — résonances documentaires déterministes (lien-fort, approche α)
// =============================================================================
//
// Spec : docs/superpowers/specs/2026-05-20-niveau-b-documents-memoire-
//        relationnelle.md (ratifications Vincent 2026-05-20).
//
// Approche α stricte : aucun cross-store cosine, aucun LLM, aucun embedding
// nouveau. Filtres AND non négociables (cf. spec §6.5) :
//   1. document_links target_type='site'        (bornage structurel)
//   2. document_type ∈ {plan_acces, securite, procedure, protocole}
//   3. target_type = 'site' (cohérent par construction)
//   4. source_domain N/A ici (on lit documents directement, pas knowledge_chunks)
//
// Garde-fous gravés :
//  - visibility_level filtré à l'indexation (operations/field uniquement) ;
//  - juridiques (litige/contrat/avenant/facture) EXCLUS d'office par #2 ;
//  - ≤ 3 résonances B1 par site (anti-bruit) ;
//  - 2 sources OBLIGATOIRES dans source_ids ;
//  - expires_at = +30j (re-validation) ;
//  - reading_type='resonance' (existant, zéro migration).
//
// Idempotent : à chaque appel, supprime les rows B1 actives pour
// (site_id, algorithm_version, doc.id) puis ré-insère. Pas de doublons.
//
// Mock-safe : aucun appel IA — déterministe. Pas de garde mock nécessaire.

interface DocRow {
  id: string
  document_type: string
  visibility_level: string
  extracted_text: string | null
  deleted_at: string | null
  analysis_status: string
}

async function fetchTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

/**
 * Calcul des résonances pour TOUS les sites liés à un document.
 * Appelé en fire-and-forget après `analyzeDocument` → status='ready'.
 * Silencieux et tolérant aux erreurs (l'analyse réussie ne doit jamais
 * être annulée par un raté de résonance).
 */
export async function computeDocResonancesForDocument(documentId: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { data: doc } = await supabase
      .from('documents')
      .select('id, document_type, visibility_level, extracted_text, deleted_at, analysis_status')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc) return
    const d = doc as DocRow
    if (d.deleted_at || d.analysis_status !== 'ready') return

    // Filtre AND #2 — types autorisés B1 (juridiques exclus d'office)
    const allTypes = [...B1_DOC_TYPES_ACCESS, ...B1_DOC_TYPES_PROCEDURE] as readonly string[]
    if (!allTypes.includes(d.document_type)) return

    // Visibilité filtrée à l'INDEXATION (défense en profondeur)
    if (!(B1_VISIBILITY_ALLOWED as readonly string[]).includes(d.visibility_level)) return

    // Filtre AND #1 — document_links target_type='site'
    const { data: links } = await supabase
      .from('document_links')
      .select('target_id')
      .eq('document_id', documentId)
      .eq('target_type', 'site')
    const siteIds = (links ?? []).map((l) => (l as { target_id: string }).target_id)
    if (siteIds.length === 0) return

    const tenantId = await fetchTenantId()
    if (!tenantId) return

    for (const siteId of siteIds) {
      await computeForOne(supabase, siteId, tenantId, d).catch(() => {})
    }
  } catch {
    // Silencieux : la résonance est un bonus, jamais bloquant.
  }
}

type Admin = ReturnType<typeof createAdminClient>

async function computeForOne(
  supabase: Admin,
  siteId: string,
  tenantId: string,
  doc: DocRow,
): Promise<void> {
  const expiresAt = new Date(Date.now() + B1_EXPIRE_DAYS * 86_400_000).toISOString()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const candidates: Array<{
    fragment: string
    source_ids: Array<{ type: string; id: string }>
    algorithm_version: string
  }> = []

  // -------------------------------------------------------------------------
  // Règle 1 — plan_acces / securite ↔ incident d'accès récent (≤30j)
  // -------------------------------------------------------------------------
  if ((B1_DOC_TYPES_ACCESS as readonly string[]).includes(doc.document_type)) {
    const { data: missions } = await supabase
      .from('missions').select('id').eq('site_id', siteId).is('deleted_at', null)
    const missionIds = (missions ?? []).map((m) => (m as { id: string }).id)
    if (missionIds.length > 0) {
      const { data: interventions } = await supabase
        .from('interventions').select('id').in('mission_id', missionIds)
      const interventionIds = (interventions ?? []).map((i) => (i as { id: string }).id)
      if (interventionIds.length > 0) {
        const { data: incidents } = await supabase
          .from('intervention_access_events')
          .select('id, occurred_at, created_at')
          .in('intervention_id', interventionIds)
          .eq('type', 'incident')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1)
        if (incidents && incidents.length > 0) {
          const inc = incidents[0] as { id: string; occurred_at: string | null; created_at: string }
          candidates.push({
            fragment: `Le plan d'accès rattaché [doc:${doc.id}] documente l'accès du site — un incident d'accès a été signalé le ${frDayMonth(inc.occurred_at ?? inc.created_at)}.`,
            source_ids: [
              { type: 'document', id: doc.id },
              { type: 'access_event', id: inc.id },
            ],
            algorithm_version: B1_ALGO_ACCESS,
          })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Règle 2 — procedure / protocole ↔ note terrain partageant un bigramme
  // -------------------------------------------------------------------------
  if (
    (B1_DOC_TYPES_PROCEDURE as readonly string[]).includes(doc.document_type) &&
    doc.extracted_text &&
    doc.extracted_text.length >= 50
  ) {
    const { data: notes } = await supabase
      .from('site_notes')
      .select('id, body, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10)
    for (const n of notes ?? []) {
      const note = n as { id: string; body: string; created_at: string }
      const common = findCommonBigrams(doc.extracted_text, note.body)
      if (common.length > 0) {
        candidates.push({
          fragment: `La procédure rattachée [doc:${doc.id}] mentionne « ${common[0]} » — une note terrain du ${frDayMonth(note.created_at)} cite ce terme.`,
          source_ids: [
            { type: 'document', id: doc.id },
            { type: 'site_note', id: note.id },
          ],
          algorithm_version: B1_ALGO_PROCEDURE,
        })
        break // 1 résonance procédure max par (doc, site) — anti-bruit
      }
    }
  }

  if (candidates.length === 0) return

  // Idempotence (V2) : double dedup.
  //  1. par doc (.like('b1_doc_%') couvre v1+v2 → migration propre) :
  //     stale les actifs où source[0].id === doc.id (même doc qu'on
  //     recalcule).
  //  2. per-trace (Vincent 2026-05-20) : stale les actifs où source[1].id
  //     est identique (autre doc partageant la même trace cible) →
  //     évite le doublon fonctionnel quand 2 docs proches matchent le
  //     même bigramme sur la même note. Last-write-wins.
  for (const c of candidates) {
    const sourceTraceId = c.source_ids[1]?.id
    const { data: existing } = await supabase
      .from('site_reading_candidates')
      .select('id, source_ids')
      .eq('site_id', siteId)
      .like('algorithm_version', 'b1_doc_%')
      .eq('status', 'active')
    const toStale = (existing ?? [])
      .filter((r) => {
        const src = (r as { source_ids: Array<{ type: string; id: string }> }).source_ids ?? []
        if (src.length === 0) return false
        // 1. même doc en source[0]
        if (src[0]?.id === doc.id) return true
        // 2. même trace en source[1] (peu importe le doc d'origine)
        if (sourceTraceId && src.length >= 2 && src[1]?.id === sourceTraceId) return true
        return false
      })
      .map((r) => (r as { id: string }).id)
    if (toStale.length > 0) {
      await supabase.from('site_reading_candidates').update({ status: 'stale' }).in('id', toStale)
    }
    await supabase.from('site_reading_candidates').insert({
      tenant_id: tenantId,
      site_id: siteId,
      reading_type: 'resonance',
      fragment: c.fragment,
      source_ids: c.source_ids,
      algorithm_version: c.algorithm_version,
      expires_at: expiresAt,
      status: 'active',
    })
  }

  // Plafond ≤ B1_MAX_PER_SITE des résonances B1 actives pour ce site.
  // Garde les plus récentes ; les autres → 'stale'.
  const { data: all } = await supabase
    .from('site_reading_candidates')
    .select('id, generated_at')
    .eq('site_id', siteId)
    .like('algorithm_version', 'b1_doc_%')
    .eq('status', 'active')
    .order('generated_at', { ascending: false })
  if (all && all.length > B1_MAX_PER_SITE) {
    const overflow = all.slice(B1_MAX_PER_SITE).map((r) => (r as { id: string }).id)
    await supabase.from('site_reading_candidates').update({ status: 'stale' }).in('id', overflow)
  }
}
