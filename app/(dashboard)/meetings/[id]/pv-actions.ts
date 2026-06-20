'use server'

import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteActionsByReport, createSiteAction, updateSiteAction } from '@/lib/db/site-actions'
import { getMeetingFollowup, formatFollowupForPv } from '@/lib/db/meeting-followup'
import { resolveReportTemplate } from '@/lib/documents/templates/cr-chantier'
import { buildPvValidation } from '@/lib/documents/pv-validation'
import { resolvePvSignal } from '@/lib/documents/pv-resolvers'
import { loadMeetingInput } from '@/lib/documents/load-meeting-input'
import { mapMeetingToCrBecib } from '@/lib/documents/meeting-to-cr-becib'
import { upsertPvSignalDecision, clearPvSignalDecision, type PvSignalStatut } from '@/lib/db/pv-signal-decisions'
import { reorderReportPhotos, setReportCoverPhoto, setCrPhotosComment } from '@/lib/db/report-photo-meta'
import { addReportHumanPoint, removeReportHumanPoint, type HumanPointSection } from '@/lib/db/report-human-points'
import { generatePv } from '@/services/ai/document-generation'
import {
  createReportDocument,
  updateReportDocumentSections,
  validateReportDocument,
} from '@/lib/db/report-documents'
import {
  listDocumentCollections,
  createDocumentCollection,
  createDocument,
  addDocumentLink,
} from '@/lib/db/documents'
import { createAdminClient } from '@/lib/supabase/admin'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import type { ReportDocumentSection, ParticipantPresence } from '@/types/db'

const CR_COLLECTION_NAME = 'Comptes-rendus de chantier'

async function requireManagerOrAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Not authenticated')
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Forbidden')
  return user
}

function meetingDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea',
  })
}

/** Génère un brouillon de PV à partir de la réunion déjà analysée. */
export async function generatePvAction(reportId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable' }

  const transcript = report.transcript_corrected || report.transcript_raw || report.text_input || ''
  if (transcript.trim().length === 0) {
    return { ok: false, error: 'Aucune transcription/note exploitable pour générer le PV.' }
  }

  const actions = await listSiteActionsByReport(reportId)
  const followup = await getMeetingFollowup({ id: report.id, site_id: report.site_id, created_at: report.created_at })
  const template = resolveReportTemplate()

  try {
    const result = await generatePv({
      template,
      transcript,
      notes: report.text_input,
      participants: report.participants ?? [],
      risks: report.risks ?? [],
      actions,
      followupText: followup ? formatFollowupForPv(followup) : null,
      meetingTitle: report.title,
      meetingDateLabel: meetingDateLabel(report.created_at),
      userId: user.id,
    })

    const id = await createReportDocument({
      report_id: reportId,
      site_id: report.site_id,
      template_key: template.key,
      sections: result.sections,
      provider: result.provider,
      model: result.model,
      prompt_version: result.promptVersion,
      created_by: user.id,
    })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true, id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[generatePvAction] failed:', e)
    return { ok: false, error: `Génération échouée : ${msg}` }
  }
}

/**
 * COMPLÉTER un point à confirmer = corriger la MÉMOIRE (décision A), via un
 * resolver (Signal → Resolver → Mutation métier). On revérifie que le signal
 * existe bien dans les gaps COURANTS de cette réunion (anti-forge / anti-stale) :
 * la cible n'est légitime que si un détecteur la produit réellement maintenant.
 * Après mutation, le gap est recalculé au prochain rendu (revalidate) et disparaît.
 */
export async function completePvSignalAction(
  reportId: string,
  resolver: string,
  refId: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const pv = await buildPvValidation(reportId)
  if (!pv) return { ok: false, error: 'Réunion introuvable' }
  const legit = pv.gaps.some((g) => g.cible && g.cible.resolver === resolver && g.cible.refId === refId)
  if (!legit) return { ok: false, error: 'Ce point n’est plus à confirmer (déjà résolu ?).' }
  try {
    await resolvePvSignal(resolver, refId, value, { reportId })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec de la complétion' }
  }
}

/**
 * DÉCIDER d'un point à confirmer sans corriger la mémoire (≠ Compléter) :
 * reporter (différé), ignorer (renoncement), faux positif (erreur de détection).
 * Auditable {statut, commentaire, auteur, date}. Revérifie que le signal existe
 * bien dans les gaps courants (anti-forge).
 */
export async function decidePvSignalAction(
  reportId: string,
  signalId: string,
  statut: PvSignalStatut,
  comment?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const pv = await buildPvValidation(reportId)
  if (!pv) return { ok: false, error: 'Réunion introuvable' }
  const gap = pv.gaps.find((g) => g.id === signalId)
  if (!gap) return { ok: false, error: 'Ce point n’est plus à confirmer.' }
  // Garde-fou métier (Vincent 2026-06-20) : un point MÉTIER (responsable/échéance
  // d'une action) ne peut être ni ignoré ni classé faux positif — sinon « pourquoi
  // l'action n'a jamais été faite ? Quelqu'un a cliqué Ignorer. ». Au max : reporter.
  if ((statut === 'ignored' || statut === 'false_positive') && (gap.nature ?? '') === 'metier') {
    return { ok: false, error: 'Un point métier ne peut pas être ignoré — complétez-le ou reportez-le.' }
  }
  try {
    await upsertPvSignalDecision({ reportId, signalId, statut, comment: comment?.trim() || null, decidedBy: user.id })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec de la décision' }
  }
}

/** Annule une décision (l'humain s'est ravisé) → le signal redevient actif. */
export async function undoPvSignalDecisionAction(
  reportId: string,
  signalId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await clearPvSignalDecision(reportId, signalId)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/**
 * EXCLURE DU PV un item parasite (ex. anomalie « szdz ») : décision sur la mémoire,
 * pas une édition du document. L'item est retiré de la CR (points examinés ET
 * prévisions, par sa source) mais reste visible barré dans l'écran de validation.
 */
export async function excludePvItemAction(
  reportId: string,
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const pv = await buildPvValidation(reportId)
  if (!pv) return { ok: false, error: 'Réunion introuvable' }
  if (!pv.items.some((it) => it.source === source)) return { ok: false, error: 'Ligne introuvable.' }
  try {
    await upsertPvSignalDecision({ reportId, signalId: source, statut: 'ignored', comment: 'exclu du PV', decidedBy: user.id })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/**
 * MODIFIER LA LÉGENDE d'une photo (la légende humaine prime ; cf. listSitePhotos).
 * Écrit la source : intervention_photos.caption (terrain) ou site_actions.completed_comment
 * (clôture d'action). Corrige la MÉMOIRE — la photo enrichie ressert partout.
 */
export async function setPhotoCaptionAction(
  reportId: string,
  photoId: string,
  source: 'intervention' | 'action',
  caption: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const sb = createAdminClient()
  const v = caption.trim() || null
  try {
    const { error } = source === 'intervention'
      ? await sb.from('intervention_photos').update({ caption: v }).eq('id', photoId)
      : await sb.from('site_actions').update({ completed_comment: v }).eq('id', photoId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────────── ACTIONS (Ajouter / Modifier / Supprimer) ─────────
// L'entité la plus fréquente d'un CR (Vincent : « dans 80 % des cas, Émeline ajoute »).
// Écrit la SOURCE (site_actions) → ressert partout (briefing, recherche, actions).

export async function addActionAction(
  reportId: string,
  input: { title: string; assignedTo?: string; dueDate?: string; corpsEtat?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Intitulé vide.' }
  const report = await getSiteReport(reportId)
  if (!report?.site_id) return { ok: false, error: 'Réunion sans site — action impossible.' }
  try {
    await createSiteAction({
      site_id: report.site_id,
      report_id: reportId,
      title,
      assigned_to: input.assignedTo?.trim() || null,
      due_date: input.dueDate || null,
      due_date_status: input.dueDate ? 'explicit' : null,
      corps_etat: input.corpsEtat?.trim() || null,
      created_by: user.id,
      created_from: 'report',
    })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function editActionAction(
  reportId: string,
  actionId: string,
  input: { title: string; assignedTo?: string; dueDate?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Intitulé vide.' }
  try {
    await updateSiteAction(actionId, {
      title,
      assigned_to: input.assignedTo?.trim() || null,
      due_date: input.dueDate || null,
      due_date_status: input.dueDate ? null : null, // date saisie = confirmée (null = figée)
    })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Supprimer = annuler (soft : status 'cancelled'). L'action sort du CR et des piliers. */
export async function deleteActionAction(reportId: string, actionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await updateSiteAction(actionId, { status: 'cancelled' })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────────── PARTICIPANTS (Ajouter / Supprimer) ────────────────

export async function addParticipantAction(
  reportId: string,
  name: string,
  role: string,
  presence: ParticipantPresence = 'P',
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const n = name.trim()
  if (!n) return { ok: false, error: 'Nom vide.' }
  try {
    const report = await getSiteReport(reportId)
    if (!report) return { ok: false, error: 'Réunion introuvable' }
    const participants = [...(report.participants ?? []), { name: n, role: role.trim() || null, kind: 'person' as const, presence }]
    const { error } = await createAdminClient().from('site_reports').update({ participants }).eq('id', reportId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function removeParticipantAction(reportId: string, index: number): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    const report = await getSiteReport(reportId)
    if (!report) return { ok: false, error: 'Réunion introuvable' }
    const participants = [...(report.participants ?? [])]
    if (index < 0 || index >= participants.length) return { ok: false, error: 'Participant introuvable.' }
    participants.splice(index, 1)
    const { error } = await createAdminClient().from('site_reports').update({ participants }).eq('id', reportId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/**
 * MODIFIER UN PARTICIPANT (#5, « Modifier la mémoire ») : corrige nom + organisme
 * dans la SOURCE (site_reports.participants). Une seule vérité : la correction
 * ressert partout (prochains CR, recherche…). Pas d'override « ce PV seulement ».
 */
export async function editParticipantAction(
  reportId: string,
  index: number,
  name: string,
  role: string,
  presence: ParticipantPresence = 'P',
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const n = name.trim()
  if (!n) return { ok: false, error: 'Nom vide.' }
  try {
    const report = await getSiteReport(reportId)
    if (!report) return { ok: false, error: 'Réunion introuvable' }
    const participants = [...(report.participants ?? [])]
    if (index < 0 || index >= participants.length) return { ok: false, error: 'Participant introuvable.' }
    participants[index] = { ...participants[index], name: n, role: role.trim() || null, presence }
    const { error } = await createAdminClient().from('site_reports').update({ participants }).eq('id', reportId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Ajoute une REMARQUE HUMAINE à une section du CR (texte libre, ≠ correction mémoire). */
export async function addHumanPointAction(
  reportId: string,
  section: HumanPointSection,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const v = text.trim()
  if (!v) return { ok: false, error: 'Texte vide.' }
  try {
    await addReportHumanPoint({ reportId, section, text: v, createdBy: user.id })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Retire une remarque humaine ajoutée. */
export async function removeHumanPointAction(
  reportId: string,
  pointId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await removeReportHumanPoint(reportId, pointId)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Réordonne les photos du CR (ordre = position dans la liste fournie). */
export async function reorderPhotosAction(
  reportId: string,
  ordered: { id: string; source: 'intervention' | 'action' }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await reorderReportPhotos(reportId, ordered)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Définit / retire la photo de COUVERTURE (1ʳᵉ du PDF, miniature du CR). */
export async function setCoverPhotoAction(
  reportId: string,
  photoId: string,
  source: 'intervention' | 'action',
  cover: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await setReportCoverPhoto(reportId, photoId, source, cover)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Commentaire général du bloc photos (texte humain, ≠ légendes par photo). */
export async function setPhotosCommentAction(
  reportId: string,
  comment: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  try {
    await setCrPhotosComment(reportId, comment.trim() || null, user.id)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Réintègre un item précédemment exclu → il revient dans la CR. */
export async function includePvItemAction(
  reportId: string,
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await clearPvSignalDecision(reportId, source)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Sauvegarde l'édition humaine des sections (brouillon uniquement). */
export async function savePvSectionsAction(
  reportId: string,
  id: string,
  sections: ReportDocumentSection[],
): Promise<{ ok: boolean; error?: string }> {
  await requireManagerOrAdmin()
  try {
    await updateReportDocumentSections(id, sections)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

async function getOrCreateCrCollection(): Promise<string> {
  const cols = await listDocumentCollections()
  const existing = cols.find((c) => c.name === CR_COLLECTION_NAME)
  if (existing) return existing.id
  return createDocumentCollection({ name: CR_COLLECTION_NAME })
}

/**
 * Fige le PV = LA TRAME UNIQUE (« Template Chantier v1 », identique à /pv), rendue
 * depuis les DONNÉES validées de la réunion (déterministe). Archive le PDF dans
 * /documents (mémoire interrogeable) et le relie au site. UN SEUL MOTEUR : plus de
 * document parallèle allégé (decision Vincent 2026-06-20). On ne réécrit pas le PV
 * à la main — on corrige la mémoire, le PV la reflète.
 */
export async function validatePvAction(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireManagerOrAdmin()
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable' }
  const input = await loadMeetingInput(reportId, { embedPhotos: true }) // photos base64 dans l'archive
  if (!input) return { ok: false, error: 'Réunion introuvable' }

  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const title = report.title || `Compte-rendu — ${identity?.name ?? 'chantier'}`

  try {
    // Même trame que /pv : gabarit haute-fidélité, identité portée par cr.meta.moe.
    const pdfBuffer = await renderToBuffer(CrBecibPdf({ cr: mapMeetingToCrBecib(input) }))

    const supabase = createAdminClient()
    const storagePath = `pv/${reportId}/cr-chantier-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, new Uint8Array(pdfBuffer), { contentType: 'application/pdf', upsert: false })
    if (upErr) return { ok: false, error: `Upload PDF échoué : ${upErr.message}` }

    const collectionId = await getOrCreateCrCollection()
    const filename = `${title}.pdf`.replace(/[/\\]/g, '-')
    const documentId = await createDocument({
      collection_id: collectionId,
      document_type: 'autre', // pas de type « compte_rendu » dans l'enum — à étendre plus tard
      storage_path: storagePath,
      filename,
      visibility_level: 'manager',
      size_bytes: pdfBuffer.length,
      analysis_status: 'pending', // sera indexé par le pipeline async → cherchable (S5)
      created_by: user.id,
    })

    if (report.site_id) {
      try {
        await addDocumentLink(documentId, 'site', report.site_id)
      } catch (e) {
        console.error('[validatePvAction] addDocumentLink failed:', e)
      }
    }

    // Trace de validation (1 PV/réunion ; déterministe → pas de sections LLM).
    const rowId = await createReportDocument({
      report_id: reportId,
      site_id: report.site_id,
      template_key: 'cr_chantier_v1',
      sections: [],
      provider: null,
      model: null,
      prompt_version: null,
      created_by: user.id,
    })
    await validateReportDocument(rowId, { document_id: documentId, pdf_path: storagePath })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[validatePvAction] failed:', e)
    return { ok: false, error: msg }
  }
}
