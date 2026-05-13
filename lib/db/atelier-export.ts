// Sprint 8 — Export Atelier IA → Dossier de préparation PDF.
//
// Helper d'agrégation : assemble le matériau brut pour un PDF de
// "Dossier de préparation" pour un AO (tender) donné.
//
// Doctrine V5 :
//   - Pilier 1 (mémoire opérationnelle par la preuve) : on AGRÈGE des
//     faits accumulés. Aucune génération créative, aucun "résumé IA".
//   - Pilier 4 (DG amplifié, jamais remplacé) : le PDF ne parle pas à
//     la place de Patrick. Il assemble.
//   - Verrou V1 (mémoire ≠ recommandation) : tout doit être descriptif
//     factuel. Pas de score, pas de "Baissez votre prix".
//   - Pilier 6 (infrastructure invisible) : tenantName en hero.
//
// Note : ce sprint NE génère PAS de signature DG (mise en quarantaine
// par Vincent dans S2). Le DG signera manuellement le PDF reçu.

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbTenderChatMessage,
  DbTenderChatAttachment,
  EngagementCategory,
  EngagementEvidence,
} from '@/types/db'
import { listChatMessages, listChatAttachments } from '@/lib/db/atelier-ia'
import { findSimilarTenderMemory, type SimilarTenderMemory } from '@/lib/db/tenders'
import { getEvidenceForEngagements } from '@/lib/db/engagements'
import { listAgentAnalyses } from '@/lib/db/agent-analyses'
import { getTenantName } from '@/lib/tenant'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface AtelierExportContext {
  description: string | null
  keyDates: {
    received?: string
    deadline?: string
    submitted?: string
  }
  /** Première portion (≤ 600 chars) du mémoire technique pour le pavé "Contexte". */
  technicalMemoExcerpt: string | null
}

export interface AtelierExportEngagement {
  id: string
  category: EngagementCategory
  short_label: string
  source_excerpt: string | null
}

export interface AtelierExportForces {
  activeContractsCount: number
  totalPhotos: number
  totalInterventions: number
  /**
   * Jours écoulés depuis le démarrage du contrat actif le plus ancien
   * (continuité opérationnelle, jamais "ancienneté agent").
   * null si aucun contrat avec start_date connue.
   */
  daysSinceFirstContract: number | null
  /** ISO date du contrat actif le plus ancien (pour wording "depuis le …"). */
  firstContractStartDate: string | null
}

/**
 * Synthèse d'un agent d'analyse pour la page agrégée du PDF.
 * On reste descriptif : on liste ce que les agents ont écrit, on ne génère pas.
 */
export interface AtelierExportAgentSynthesis {
  agentName: string // ChatAgentName as string
  /** Label humain (« Lecteur AO », « Mémoire technique », …) */
  label: string
  /** Rôle haut niveau pour groupement visuel : commerciale / strategique / operationnelle. */
  role: 'commerciale' | 'strategique' | 'operationnelle'
  /** Contenu markdown du résumé/raw, déjà disponible (jamais re-généré). */
  content: string
}

export interface AtelierExportData {
  tender: {
    id: string
    title: string
    client_name: string | null
    created_at: string
    submitted_at: string | null // pas en DB pour l'instant — null systématique
    outcome: string | null
    status: string
  }
  context: AtelierExportContext
  engagements: AtelierExportEngagement[]
  similarTenders: SimilarTenderMemory[]
  /** Evidence par engagement_id (réutilise Phase 4). */
  evidence: Map<string, EngagementEvidence>
  forces: AtelierExportForces
  agentSyntheses: AtelierExportAgentSynthesis[]
  chatMessages: DbTenderChatMessage[]
  chatAttachments: DbTenderChatAttachment[]
  /** Mémoire technique complète (peut être longue). null si non disponible. */
  technicalMemo: string | null
  generatedAt: string
  tenantName: string
}

// ----------------------------------------------------------------------------
// Mapping agent → rôle haut niveau (groupement visuel page 8)
// Doctrine : descriptif. C'est juste un classement éditorial pour le rendu.
// ----------------------------------------------------------------------------

const AGENT_ROLE: Record<string, AtelierExportAgentSynthesis['role']> = {
  general: 'strategique',
  lecteur_ao: 'strategique',
  memoire_technique: 'strategique',
  contradicteur: 'strategique',
  financier: 'commerciale',
  terrain: 'operationnelle',
  conformite: 'operationnelle',
}

const AGENT_LABEL: Record<string, string> = {
  general: 'Général',
  lecteur_ao: 'Lecteur AO',
  memoire_technique: 'Mémoire technique',
  contradicteur: 'Contradicteur',
  financier: 'Financier',
  terrain: 'Terrain',
  conformite: 'Conformité',
}

// ----------------------------------------------------------------------------
// Main aggregator
// ----------------------------------------------------------------------------

/**
 * Agrège l'ensemble du capital d'un AO pour un export PDF "Dossier de
 * préparation". Une seule séquence de requêtes : un appel par sous-domaine,
 * jamais un N+1 cross-engagement (réutilise getEvidenceForEngagements en batch).
 *
 * Retourne null si le tender n'existe pas ou est soft-deleted.
 */
export async function getAtelierExportData(
  tenderId: string,
): Promise<AtelierExportData | null> {
  const supabase = createAdminClient()

  // 1) Tender (non supprimé)
  const { data: tenderRow } = await supabase
    .from('tenders')
    .select(
      'id, title, client_name, deadline, status, outcome, created_at, deleted_at',
    )
    .eq('id', tenderId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!tenderRow) return null

  // 2) Engagements de l'AO courant
  const { data: engagementsRows } = await supabase
    .from('engagements')
    .select('id, category, short_label, source_excerpt')
    .eq('tender_id', tenderId)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true })
  const engagements: AtelierExportEngagement[] = (engagementsRows ?? []).map(
    (e) => ({
      id: e.id as string,
      category: e.category as EngagementCategory,
      short_label: (e.short_label as string) ?? '',
      source_excerpt: (e.source_excerpt as string | null) ?? null,
    }),
  )

  // 3) Latest analysis → technical memo
  const { data: analysisRow } = await supabase
    .from('tender_analyses')
    .select('summary, technical_memo, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const technicalMemo =
    (analysisRow?.technical_memo as string | null) ?? null
  const technicalMemoExcerpt =
    typeof technicalMemo === 'string' && technicalMemo.length > 0
      ? technicalMemo.slice(0, 600)
      : null
  const summary = (analysisRow?.summary as string | null) ?? null

  // 4) Similar tenders memory (Sprint 1)
  let similarTenders: SimilarTenderMemory[] = []
  try {
    similarTenders = await findSimilarTenderMemory(tenderId, { limit: 5 })
  } catch {
    similarTenders = []
  }

  // 5) Evidence pour les engagements de l'AO courant (Phase 4 — batch)
  const engagementIds = engagements.map((e) => e.id)
  let evidence: Map<string, EngagementEvidence> = new Map()
  if (engagementIds.length > 0) {
    try {
      evidence = await getEvidenceForEngagements(engagementIds)
    } catch {
      evidence = new Map()
    }
  }

  // 6) Forces — contrats actifs / photos / interventions / continuité
  const forces = await aggregateForces(supabase)

  // 7) Agent analyses (si déjà calculées en base)
  let agentSyntheses: AtelierExportAgentSynthesis[] = []
  try {
    const analyses = await listAgentAnalyses(tenderId)
    agentSyntheses = analyses
      .filter((a) => a.status === 'ready' && (a.summary || a.raw_content))
      .map((a) => {
        const name = a.agent_name as string
        const content =
          (a.summary && a.summary.trim().length > 0
            ? a.summary
            : a.raw_content) ?? ''
        return {
          agentName: name,
          label: AGENT_LABEL[name] ?? name,
          role: AGENT_ROLE[name] ?? 'strategique',
          content,
        }
      })
  } catch {
    agentSyntheses = []
  }

  // 8) Chat messages + attachments
  let chatMessages: DbTenderChatMessage[] = []
  let chatAttachments: DbTenderChatAttachment[] = []
  try {
    chatMessages = await listChatMessages(tenderId)
    if (chatMessages.length > 0) {
      chatAttachments = await listChatAttachments(
        chatMessages.map((m) => m.id),
      )
    }
  } catch {
    chatMessages = []
    chatAttachments = []
  }

  const tenantName = getTenantName()

  // 9) keyDates : received = tender.created_at, deadline = tender.deadline,
  //    submitted = null (pas de colonne `submitted_at` en DB à ce sprint).
  const keyDates: AtelierExportContext['keyDates'] = {}
  if (tenderRow.created_at) keyDates.received = tenderRow.created_at as string
  if (tenderRow.deadline) keyDates.deadline = tenderRow.deadline as string

  return {
    tender: {
      id: tenderRow.id as string,
      title: (tenderRow.title as string) ?? '',
      client_name: (tenderRow.client_name as string | null) ?? null,
      created_at: (tenderRow.created_at as string) ?? new Date().toISOString(),
      submitted_at: null,
      outcome: (tenderRow.outcome as string | null) ?? null,
      status: (tenderRow.status as string) ?? 'unknown',
    },
    context: {
      description: summary,
      keyDates,
      technicalMemoExcerpt,
    },
    engagements,
    similarTenders,
    evidence,
    forces,
    agentSyntheses,
    chatMessages,
    chatAttachments,
    technicalMemo,
    generatedAt: new Date().toISOString(),
    tenantName,
  }
}

// ----------------------------------------------------------------------------
// Forces aggregation
// ----------------------------------------------------------------------------

async function aggregateForces(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<AtelierExportForces> {
  // Contrats actifs
  const { count: activeContractsCount } = await supabase
    .from('contracts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('deleted_at', null)

  // Photos totales
  const { count: totalPhotos } = await supabase
    .from('intervention_photos')
    .select('id', { count: 'exact', head: true })

  // Interventions documentées (completed ou validated)
  const { count: totalInterventions } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['completed', 'validated'])

  // Premier contrat actif (par start_date asc) — continuité opérationnelle
  const { data: firstContractRows } = await supabase
    .from('contracts')
    .select('start_date')
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('start_date', 'is', null)
    .order('start_date', { ascending: true })
    .limit(1)
  const firstStart =
    (firstContractRows?.[0]?.start_date as string | null | undefined) ?? null

  let daysSinceFirstContract: number | null = null
  if (firstStart) {
    const t0 = new Date(firstStart).getTime()
    const now = Date.now()
    if (!Number.isNaN(t0)) {
      daysSinceFirstContract = Math.max(
        0,
        Math.floor((now - t0) / (1000 * 60 * 60 * 24)),
      )
    }
  }

  return {
    activeContractsCount: activeContractsCount ?? 0,
    totalPhotos: totalPhotos ?? 0,
    totalInterventions: totalInterventions ?? 0,
    daysSinceFirstContract,
    firstContractStartDate: firstStart,
  }
}
