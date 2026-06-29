'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { updateTenderStatus, softDeleteTender, getTender, getTenderDocument, countAnalysesToday, attachTenderToDossier } from '@/lib/db/tenders'
import { getEvidenceForEngagement } from '@/lib/db/engagements'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const idSchema = z.object({ id: z.string().uuid() })

// Soudure AVANT : rattacher/détacher cet AO à une opportunité (dossier). dossierId
// vide = détacher. Aucune copie de données — simple référence. Cf. mig 175.
export async function setTenderDossierAction(formData: FormData): Promise<void> {
  await requireManagerOrAdmin()
  const tenderId = String(formData.get('tenderId') ?? '')
  const dossierId = String(formData.get('dossierId') ?? '')
  if (!z.string().uuid().safeParse(tenderId).success) throw new Error('AO invalide')
  await attachTenderToDossier(tenderId, dossierId || null)
  revalidatePath(`/tenders/${tenderId}`)
}

export async function relaunchAnalysisAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const tender = await getTender(parsed.data.id)
  if (!tender) return { error: 'Dossier introuvable' }

  const doc = await getTenderDocument(parsed.data.id)
  if (!doc || !doc.extracted_text) return { error: 'Pas de texte extrait — re-uploader le PDF' }

  const todayCount = await countAnalysesToday()
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) {
    return { error: `Quota journalier atteint (${todayCount}/${limit}).` }
  }

  await updateTenderStatus(parsed.data.id, 'analyzing', null)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'analysis_relaunched',
    metadata: {},
  })
  revalidatePath(`/tenders/${parsed.data.id}`)

  // L'analyse NE tourne PLUS en after() (coupé par Vercel). Le statut passe
  // 'analyzing' ; le client (loader) la déclenche via POST /api/tenders/[id]/analyze
  // dans une vraie requête HTTP (fiable).
  return { ok: true }
}

export async function archiveTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  await softDeleteTender(parsed.data.id)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'soft_deleted',
    metadata: {},
  })
  revalidatePath('/tenders')
  redirect('/tenders')
}

// ============================================================================
// Slice 4.3 — Insertion 1-clic d'une preuve dans la mémoire technique
// ============================================================================

interface InsertEvidenceParams {
  tenderId: string
  engagementId: string
}

interface InsertEvidenceResult {
  ok: boolean
  alreadyInserted?: boolean
  error?: string
}

function formatDurationFr(days: number | null): string {
  if (!days) return ''
  if (days < 30) return `${days} jours`
  if (days < 365) return `${Math.round(days / 30)} mois`
  const years = Math.floor(days / 365)
  const months = Math.round((days % 365) / 30)
  if (months === 0) return `${years} an${years > 1 ? 's' : ''}`
  return `${years} an${years > 1 ? 's' : ''} ${months} mois`
}

/**
 * Slice 4.3 — Insère une phrase de preuve formatée à la fin du mémoire
 * technique du tender. Idempotent via marker HTML `<!-- ref: engagement:UUID -->`.
 *
 * Doctrine : la phrase mentionne le CONTRAT (preuve factuelle), jamais une personne.
 * Pas de score, pas de performance individuelle.
 */
export async function insertEvidenceIntoMemoire({
  tenderId,
  engagementId,
}: InsertEvidenceParams): Promise<InsertEvidenceResult> {
  // Auth + droit d'écriture sur le mémoire
  let userId: string
  try {
    userId = await requireManagerOrAdmin()
  } catch {
    return { ok: false, error: 'Non autorisé' }
  }

  const supabase = await createServerClient()

  // Fetch tender_analysis (latest)
  const { data: analysis, error: fetchErr } = await supabase
    .from('tender_analyses')
    .select('id, technical_memo')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchErr || !analysis) {
    return { ok: false, error: "Analyse du dossier introuvable" }
  }

  const currentMemo = analysis.technical_memo ?? ''
  const marker = `<!-- ref: engagement:${engagementId} -->`

  // Already inserted? Idempotent — no-op
  if (currentMemo.includes(marker)) {
    return { ok: true, alreadyInserted: true }
  }

  // Fetch engagement
  const { data: engagement, error: engErr } = await supabase
    .from('engagements')
    .select('id, short_label, source_excerpt, category')
    .eq('id', engagementId)
    .maybeSingle()

  if (engErr || !engagement) {
    return { ok: false, error: 'Engagement source introuvable' }
  }

  const evidence = await getEvidenceForEngagement(engagementId)

  if (!evidence || evidence.interventionsExecuted === 0) {
    return { ok: false, error: 'Pas assez de preuves pour cet engagement' }
  }

  // Build the proof snippet — mentionne le CONTRAT, pas une personne
  const contractLabel =
    evidence.contractNames.length === 1
      ? `le contrat **${evidence.contractNames[0]}**`
      : evidence.contractNames.length > 1
        ? `nos contrats **${evidence.contractNames.slice(0, 2).join('** et **')}**${
            evidence.contractNames.length > 2
              ? ` (+${evidence.contractNames.length - 2})`
              : ''
          }`
        : 'nos contrats opérationnels'

  const durationLabel = formatDurationFr(evidence.durationDays)
  const validationPercent = Math.round(evidence.validationRate * 100)

  const interventionWord =
    evidence.interventionsExecuted > 1 ? 'interventions' : 'intervention'
  const parts: string[] = [
    `Sur ${contractLabel}, nous avons réalisé **${evidence.interventionsExecuted.toLocaleString('fr-FR')} ${interventionWord}**`,
  ]
  if (evidence.photosCount > 0) {
    const photoWord = evidence.photosCount > 1 ? 'photos de preuve' : 'photo de preuve'
    parts.push(`avec **${evidence.photosCount.toLocaleString('fr-FR')} ${photoWord}**`)
  }
  if (durationLabel) {
    parts.push(`sur **${durationLabel}**`)
  }
  if (validationPercent > 0) {
    parts.push(`(taux de validation : ${validationPercent}%)`)
  }

  const sentence = parts.join(' ') + '.'
  const snippet = `\n\n> 📊 ${sentence}\n${marker}\n`
  const newMemo = currentMemo.trimEnd() + snippet

  // Persist
  const { error: updateErr } = await supabase
    .from('tender_analyses')
    .update({ technical_memo: newMemo })
    .eq('id', analysis.id)

  if (updateErr) {
    return { ok: false, error: `Échec sauvegarde : ${updateErr.message}` }
  }

  await logAuditEvent({
    userId,
    entityType: 'tender',
    entityId: tenderId,
    action: 'evidence_inserted',
    metadata: { engagement_id: engagementId },
  })

  revalidatePath(`/tenders/${tenderId}`)

  return { ok: true }
}
