'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { runEngagementExtractionAgent } from '@/services/ai/engagement-extraction'
import {
  activateEngagementsForContract,
  archiveEngagement,
  bulkInsertEngagements,
  createEngagementManual,
  curateEngagement,
  deleteExtractedEngagementsByTender,
  hasLinkedInterventions,
  listEngagementsByTender,
  rejectEngagements,
} from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'
import { getTender, listTenderDocuments, getLatestTenderAnalysis } from '@/lib/db/tenders'
import { createVerifiedEngagementProvenanceResolver } from '@/lib/tenders/engagement-provenance'
import {
  buildExtractionSources,
  dedupeEngagements,
  mapWithConcurrency,
  type OrchestratedEngagement,
} from '@/lib/tenders/extract-engagements'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { readableError } from '@/lib/errors'

// Concurrence des passes IA : au plus 3 appels simultanés (évite quotas /
// timeouts / pics de charge quand un dossier a beaucoup de pièces).
const EXTRACTION_CONCURRENCY = 3

const extractSchema = z.object({ tender_id: z.string().uuid() })

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

export async function extractEngagementsAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = extractSchema.safeParse({ tender_id: formData.get('tender_id') })
  if (!parsed.success) return { error: 'Invalid input' }

  const existing = await listEngagementsByTender(parsed.data.tender_id)
  if (existing.length > 0) return { error: 'Engagements déjà extraits pour ce dossier' }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'Dossier introuvable' }

  // Un AO est un DOSSIER : on extrait PIÈCE PAR PIÈCE, chaque pièce en entier
  // dans sa propre passe (les clauses profondes du CCAP/CCTP ne sont plus
  // tronquées par un corpus commun). + une passe dédiée au mémoire technique.
  const [docs, analysis] = await Promise.all([
    listTenderDocuments(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
  ])
  const sources = buildExtractionSources(
    docs.map((d) => ({ id: d.id, filename: d.filename, kind: d.kind, extractedText: d.extracted_text })),
    analysis?.technical_memo ?? null,
  )
  if (sources.length === 0) return { error: 'Aucune pièce lisible ni mémoire technique dans ce dossier' }

  // Vérificateur de PAGE par pièce, dans le document DÉJÀ CONNU : on ne réattribue
  // jamais un engagement à une autre pièce (le document vient de la passe, pas
  // d'un match de citation). Le résolveur ne sert plus qu'à localiser/vérifier la
  // page à l'intérieur de sa propre pièce.
  const pageResolverByDoc = new Map<string, (excerpt: string) => { page_number: number | null }>()
  for (const d of docs) {
    if (d.extracted_text && d.extracted_text.trim().length > 0) {
      pageResolverByDoc.set(d.id, createVerifiedEngagementProvenanceResolver({
        documents: [{ id: d.id, filename: d.filename, kind: d.kind, extractedText: d.extracted_text }],
      }))
    }
  }

  const failures: Array<{ label: string; error: string }> = []
  let count = 0
  try {
    // Passes IA à concurrence bornée. Reprise partielle : une pièce qui échoue
    // n'annule pas les autres — on collecte les succès et on signale les échecs.
    const perSource = await mapWithConcurrency(sources, EXTRACTION_CONCURRENCY, async (src) => {
      try {
        const res = await runEngagementExtractionAgent({
          sourceText: src.sourceText,
          sourceType: src.sourceType,
          tenderDocumentId: src.tenderDocumentId,
          sourceLabel: src.sourceLabel,
          userId: auth.userId,
        })
        return res.engagements.map((e): OrchestratedEngagement => ({
          ...e,
          // Nature et provenance CONNUES (pas devinées) : elles viennent de la
          // passe, pas de l'IA ni d'un match de citation. La page est vérifiée
          // DANS cette pièce (null si la citation y est introuvable).
          source_type: src.sourceType,
          tender_document_id: src.tenderDocumentId,
          page_number: src.tenderDocumentId
            ? pageResolverByDoc.get(src.tenderDocumentId)?.(e.source_excerpt).page_number ?? null
            : null,
        }))
      } catch (e) {
        console.error(`[extractEngagementsAction] passe échouée : ${src.sourceLabel}`, e)
        failures.push({ label: src.sourceLabel, error: readableError(e) })
        return [] as OrchestratedEngagement[]
      }
    })

    const engagements = dedupeEngagements(perSource.flat())

    if (engagements.length === 0) {
      if (failures.length > 0) {
        return { error: `Extraction échouée sur toutes les sources : ${failures.map((f) => `${f.label} (${f.error})`).join(' ; ').slice(0, 300)}` }
      }
      return { error: "Aucun engagement détecté dans ce dossier (l'IA n'a rien retourné d'exploitable)." }
    }

    await bulkInsertEngagements({
      tender_id: parsed.data.tender_id,
      created_by: auth.userId,
      engagements,
    })
    count = engagements.length
  } catch (e) {
    console.error('[extractEngagementsAction] échec extraction/insertion:', e)
    return { error: `Extraction impossible : ${readableError(e).slice(0, 300)}` }
  }

  revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
  // Succès partiel : on insère ce qui a marché et on signale les pièces en échec.
  return { ok: true as const, count, failedSources: failures.length }
}

// Réinitialise les engagements EXTRAITS d'un dossier pour permettre une nouvelle
// extraction (l'extraction refuse tant qu'il en existe). Réservé admin/manager.
// Garde : refuse si un engagement est déjà rattaché à un contrat — on ne détruit
// pas un vrai engagement pour relancer l'IA.
export async function resetEngagementsAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = extractSchema.safeParse({ tender_id: formData.get('tender_id') })
  if (!parsed.success) return { error: 'Invalid input' }

  const existing = await listEngagementsByTender(parsed.data.tender_id)
  const activated = existing.filter((e) => e.contract_id !== null)
  if (activated.length > 0) {
    return { error: `Réinitialisation impossible : ${activated.length} engagement${activated.length > 1 ? 's' : ''} déjà rattaché${activated.length > 1 ? 's' : ''} à un contrat. Elle est réservée aux dossiers non convertis.` }
  }

  try {
    const count = await deleteExtractedEngagementsByTender(parsed.data.tender_id)
    revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
    return { ok: true as const, count }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'reset failed' }
  }
}

const curateSchema = z.object({
  id: z.string().uuid(),
  short_label: z.string().min(3).max(100).optional(),
  category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']).optional(),
  kind: z.enum(['objectif', 'obligation', 'livrable', 'controle', 'penalite']).optional(),
  measurable: z.boolean().optional(),
  proof_requirement: z.enum(['photo', 'anomaly_documented', 'none']).optional(),
  destination: z.enum(['contract_engagement', 'vigilance', 'a_savoir', 'mission']).optional(),
})

export async function curateEngagementAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const measurableRaw = formData.get('measurable')
  const measurable = measurableRaw === 'true' ? true : measurableRaw === 'false' ? false : undefined

  const parsed = curateSchema.safeParse({
    id: formData.get('id'),
    short_label: formData.get('short_label') || undefined,
    category: formData.get('category') || undefined,
    kind: formData.get('kind') || undefined,
    measurable,
    proof_requirement: formData.get('proof_requirement') || undefined,
    destination: formData.get('destination') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { id, ...patch } = parsed.data
  try {
    await curateEngagement(id, patch)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'curate failed' }
  }
  // path is the tender page; revalidate via the tender_id is more accurate but not strictly needed
  return { ok: true as const }
}

const rejectSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) })

export async function rejectEngagementsAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const idsRaw = formData.get('ids') as string | null
  if (!idsRaw) return { error: 'No ids provided' }
  const idsList = idsRaw.split(',').map((s) => s.trim()).filter(Boolean)

  const parsed = rejectSchema.safeParse({ ids: idsList })
  if (!parsed.success) return { error: 'Invalid ids' }

  try {
    await rejectEngagements(parsed.data.ids)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'reject failed' }
  }
  return { ok: true as const, count: parsed.data.ids.length }
}

const archiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(3).max(200),
})

export async function archiveEngagementAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = archiveSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const hasStarted = await hasLinkedInterventions(parsed.data.id)
  if (hasStarted) return { error: 'Des interventions sont liées — seul le label est modifiable' }

  try {
    await archiveEngagement(parsed.data.id, parsed.data.reason)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'archive failed' }
  }
  return { ok: true as const }
}

const createManualEngagementSchema = z.object({
  tender_id: z.string().uuid(),
  short_label: z.string().min(3).max(100),
  category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']),
})

export async function createEngagementManualAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createManualEngagementSchema.safeParse({
    tender_id: formData.get('tender_id'),
    short_label: formData.get('short_label'),
    category: formData.get('category'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    await createEngagementManual({
      tender_id: parsed.data.tender_id,
      contract_id: null,
      short_label: parsed.data.short_label,
      category: parsed.data.category,
      created_by: auth.userId,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'create failed' }
  }

  revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
  return { ok: true as const }
}

const createContractSchema = z.object({
  tender_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  client_name: z.string().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function createContractAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createContractSchema.safeParse({
    tender_id: formData.get('tender_id'),
    name: formData.get('name'),
    client_name: formData.get('client_name'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  let contractId: string
  try {
    contractId = await createContract({
      tender_id: parsed.data.tender_id,
      name: parsed.data.name,
      client_name: parsed.data.client_name,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      created_by: auth.userId,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'create contract failed' }
  }

  let activatedCount = 0
  try {
    activatedCount = await activateEngagementsForContract(parsed.data.tender_id, contractId)
  } catch (e) {
    // Contract is created but engagements not activated — return ID anyway
    console.error('[createContractAction] activation failed:', e)
  }

  return { ok: true as const, contractId, activatedCount }
}
