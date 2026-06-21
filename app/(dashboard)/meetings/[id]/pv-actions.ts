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
import { setReportPointActions } from '@/lib/db/report-point-actions'
import { addReportPhoto, deleteReportPhoto } from '@/lib/db/report-photos'
import { addReportAddedPoint, deleteReportAddedPoint } from '@/lib/db/report-added-points'
import {
  createSiteDecision, updateSiteDecision, deleteSiteDecision,
  type DecisionStatut, type DecisionImpact,
} from '@/lib/db/site-decisions'
import { findOrCreateCompanyByName } from '@/lib/db/companies'
import { createContact } from '@/lib/db/company-contacts'
import { openSiteIntervenant, closeSiteIntervenant } from '@/lib/db/site-intervenants'
import { recordCorrections, type CorrectionEvent } from '@/lib/db/memory-corrections'
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
  const user = await requireManagerOrAdmin()
  const pv = await buildPvValidation(reportId)
  if (!pv) return { ok: false, error: 'Réunion introuvable' }
  const legit = pv.gaps.some((g) => g.cible && g.cible.resolver === resolver && g.cible.refId === refId)
  if (!legit) return { ok: false, error: 'Ce point n’est plus à confirmer (déjà résolu ?).' }
  try {
    await resolvePvSignal(resolver, refId, value, { reportId })
    // Capture passive : un trou détecté par l'IA et comblé par l'humain (donnée d'or).
    await recordCorrections({ reportId, actorId: user.id, events: [{ entity: 'document_field', field: resolver, category: 'completion', op: 'added', after: value, sourceType: 'ai' }] })
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
    // Signal d'apprentissage : l'IA a proposé une ligne que l'humain juge parasite.
    await recordCorrections({ reportId, actorId: user.id, events: [{ entity: 'pv_item', field: source.split(':')[0] || null, category: 'exclusion', op: 'removed', before: source, sourceType: 'ai' }] })
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
  source: 'intervention' | 'action' | 'report',
  caption: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const sb = createAdminClient()
  const v = caption.trim() || null
  try {
    const { error } =
      source === 'intervention'
        ? await sb.from('intervention_photos').update({ caption: v }).eq('id', photoId)
        : source === 'report'
          ? await sb.from('report_photos').update({ caption: v }).eq('id', photoId).eq('report_id', reportId)
          : await sb.from('site_actions').update({ completed_comment: v }).eq('id', photoId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────────── PHOTOS report (Ajouter / Supprimer directement) ───
// Reconstruction manuelle du PV (mig 133) : Émeline joint une photo même sans
// remontée terrain. Photo report = ajout ÉDITORIAL → vraie suppression autorisée
// (≠ « exclure » réversible des photos intervention/action, qui sont des artefacts).
const PHOTO_MAX_BYTES = 12 * 1024 * 1024 // 12 Mo
const PHOTO_TYPES = /^image\/(jpe?g|png|webp|gif|heic|heif)$/i

export async function addReportPhotoAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const reportId = String(formData.get('report_id') ?? '')
  const file = formData.get('file')
  const caption = String(formData.get('caption') ?? '')
  if (!reportId) return { ok: false, error: 'Réunion inconnue.' }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Aucun fichier.' }
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: 'Fichier trop lourd (max 12 Mo).' }
  if (!PHOTO_TYPES.test(file.type)) return { ok: false, error: 'Format image non supporté.' }
  try {
    const sb = createAdminClient()
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
    const storagePath = `report/${reportId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('intervention-photos')
      .upload(storagePath, buffer, { contentType: file.type, upsert: false })
    if (upErr) return { ok: false, error: `Upload échoué : ${upErr.message}` }
    await addReportPhoto({ reportId, storagePath, caption, createdBy: user.id })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function deleteReportPhotoAction(
  reportId: string,
  photoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    const path = await deleteReportPhoto(reportId, photoId)
    if (path) {
      // Purge du bucket (best-effort : la ligne est déjà supprimée, la vérité = la DB).
      await createAdminClient().storage.from('intervention-photos').remove([path]).catch(() => {})
    }
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
    await recordCorrections({ reportId, siteId: report.site_id, actorId: user.id, events: [{ entity: 'action', category: 'action', op: 'added', after: title, sourceType: 'human' }] })
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
  const user = await requireManagerOrAdmin()
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Intitulé vide.' }
  try {
    await updateSiteAction(actionId, {
      title,
      assigned_to: input.assignedTo?.trim() || null,
      due_date: input.dueDate || null,
      due_date_status: input.dueDate ? null : null, // date saisie = confirmée (null = figée)
    })
    await recordCorrections({ reportId, actorId: user.id, events: [{ entity: 'action', field: 'contenu', category: 'action', op: 'edited', after: title }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Supprimer = annuler (soft : status 'cancelled'). L'action sort du CR et des piliers. */
export async function deleteActionAction(reportId: string, actionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  try {
    await updateSiteAction(actionId, { status: 'cancelled' })
    await recordCorrections({ reportId, actorId: user.id, events: [{ entity: 'action', category: 'action', op: 'removed' }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

/** Colonne ACTION d'un point examiné : codes responsables (ETV/MOA/MOE/FSH/CLUB),
 *  multi. Stocké en mémoire (clé = source du point) → rendu dans le CR. */
export async function setPointActionsAction(
  reportId: string,
  pointSource: string,
  codes: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  try {
    await setReportPointActions(reportId, pointSource, codes)
    await recordCorrections({ reportId, actorId: user.id, events: [{ entity: 'point_action', field: 'codes', category: 'action', op: 'edited', after: codes.join('/') }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────── CASTING DU CHANTIER (mig 137) ─────────────────────────
// Qui est qui : rôle → entreprise → contact. Saisie depuis la revue CR (donnée
// SITE, réutilisée par tous ses CR). Crée l'entreprise (find-or-create par nom) et
// son contact principal au passage → registres peuplés sans page d'admin séparée.

/** organization_id + date du site porteur de la réunion (scope entreprises + effective_from). */
async function siteOrgOfReport(reportId: string): Promise<{ siteId: string; orgId: string; reportDate: string } | null> {
  const report = await getSiteReport(reportId)
  if (!report?.site_id) return null
  const { data } = await createAdminClient().from('sites').select('organization_id').eq('id', report.site_id).maybeSingle()
  const orgId = (data as { organization_id: string | null } | null)?.organization_id
  if (!orgId) return null
  return { siteId: report.site_id, orgId, reportDate: report.created_at.slice(0, 10) }
}

export async function addSiteIntervenantAction(
  reportId: string,
  input: {
    role: string; companyName: string
    contactName?: string; contactFunction?: string; contactPhone?: string; contactMobile?: string; contactEmail?: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const role = input.role.trim()
  const companyName = input.companyName.trim()
  if (!role) return { ok: false, error: 'Rôle manquant.' }
  if (!companyName) return { ok: false, error: 'Entreprise manquante.' }
  const ctx = await siteOrgOfReport(reportId)
  if (!ctx) return { ok: false, error: 'Réunion sans site/organisation.' }
  try {
    const companyId = await findOrCreateCompanyByName(ctx.orgId, companyName)
    let contactId: string | null = null
    if (input.contactName?.trim()) {
      contactId = await createContact(companyId, {
        fullName: input.contactName,
        function: input.contactFunction,
        phone: input.contactPhone,
        mobile: input.contactMobile,
        email: input.contactEmail,
        isMain: true,
      })
    }
    // Lien ACTIF, daté du CR (assurance historique : on n'écrase jamais, mig 138).
    await openSiteIntervenant({ siteId: ctx.siteId, role, companyId, mainContactId: contactId, effectiveFrom: ctx.reportDate, sourceReportId: reportId })
    await recordCorrections({ reportId, siteId: ctx.siteId, actorId: user.id, events: [{ entity: 'casting', field: 'organisme', category: 'organisation', op: 'added', after: `${role} = ${companyName}`, sourceType: 'human' }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function deleteSiteIntervenantAction(
  reportId: string,
  intervenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const ctx = await siteOrgOfReport(reportId)
  if (!ctx) return { ok: false, error: 'Réunion sans site.' }
  try {
    // CLÔTURE (effective_to = date du CR), pas suppression → l'historique reste.
    await closeSiteIntervenant(ctx.siteId, intervenantId, ctx.reportDate)
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────────── DÉCISIONS (mig 136) ───────────────────────────────
// « On a décidé que… » — mémoire DURABLE du site, ni action ni prévision. Projetée
// dans le spine (Points administratifs). MVP : ajout manuel = source human, confiance
// sûr, statut actée ; l'extraction IA (source transcript / proposée / à confirmer) plus tard.

export async function addDecisionAction(
  reportId: string,
  input: {
    titre: string; description?: string; sujet?: string
    decisionnaireRole?: string; decisionnaireContactId?: string; impact?: DecisionImpact | ''; echeance?: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const titre = input.titre.trim()
  if (!titre) return { ok: false, error: 'Intitulé de décision vide.' }
  const report = await getSiteReport(reportId)
  if (!report?.site_id) return { ok: false, error: 'Réunion sans site — décision impossible.' }
  try {
    await createSiteDecision({
      siteId: report.site_id,
      reportId,
      titre,
      description: input.description,
      sujet: input.sujet,
      decisionnaireRole: input.decisionnaireRole,
      decisionnaireContactId: input.decisionnaireContactId,
      impact: input.impact ? (input.impact as DecisionImpact) : null,
      echeance: input.echeance,
      dateDecision: report.created_at ? report.created_at.slice(0, 10) : null, // date du CR
      createdBy: user.id,
    })
    await recordCorrections({ reportId, siteId: report.site_id, actorId: user.id, events: [{ entity: 'decision', category: 'decision', op: 'added', after: titre, sourceType: 'human' }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function editDecisionAction(
  reportId: string,
  decisionId: string,
  patch: {
    titre?: string; description?: string; sujet?: string
    decisionnaireRole?: string; decisionnaireContactId?: string | null; actionId?: string | null
    impact?: DecisionImpact | ''; echeance?: string
    statut?: DecisionStatut; confiance?: 'sûr' | 'à confirmer'
    timeToCorrectMs?: number | null // temps passé côté client (mig 140)
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const report = await getSiteReport(reportId)
  if (!report?.site_id) return { ok: false, error: 'Réunion sans site.' }
  try {
    await updateSiteDecision(report.site_id, decisionId, {
      titre: patch.titre,
      description: patch.description,
      sujet: patch.sujet,
      decisionnaireRole: patch.decisionnaireRole,
      decisionnaireContactId: patch.decisionnaireContactId,
      actionId: patch.actionId,
      echeance: patch.echeance,
      statut: patch.statut,
      impact: patch.impact === '' ? null : patch.impact,
      confiance: patch.confiance,
    })
    // Capture passive : on logue le ou les champs réellement présents dans le patch.
    const field = patch.statut ? 'statut' : patch.actionId !== undefined ? 'action_liee' : patch.decisionnaireContactId !== undefined ? 'decisionnaire' : 'contenu'
    await recordCorrections({ reportId, siteId: report.site_id, actorId: user.id, events: [{ entity: 'decision', field, category: 'decision', op: 'edited', after: patch.statut ?? patch.titre ?? null, timeToCorrectMs: patch.timeToCorrectMs ?? null }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function deleteDecisionAction(
  reportId: string,
  decisionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const report = await getSiteReport(reportId)
  if (!report?.site_id) return { ok: false, error: 'Réunion sans site.' }
  try {
    await deleteSiteDecision(report.site_id, decisionId)
    await recordCorrections({ reportId, siteId: report.site_id, actorId: user.id, events: [{ entity: 'decision', category: 'decision', op: 'removed' }] })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

// ───────────────────────── POINTS STRUCTURÉS ajoutés en séance (mig 134) ─────────
// « Ajouter une anomalie » / « Ajouter une prévision structurée » : objet TYPÉ saisi
// par l'humain (≠ texte libre). Anomalie → Points examinés ; prévision → Prévisions.
// Ajout éditorial mémorisé → vraie suppression autorisée.

export async function addAnomalieAction(
  reportId: string,
  input: { label: string; statut?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Description vide.' }
  try {
    await addReportAddedPoint({ reportId, kind: 'anomalie', label, statut: input.statut, createdBy: user.id })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function addPrevisionAction(
  reportId: string,
  input: { label: string; assignedTo?: string; dueDate?: string; confiance?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Intitulé vide.' }
  try {
    await addReportAddedPoint({
      reportId, kind: 'prevision', label,
      assignedTo: input.assignedTo, dueDate: input.dueDate, confiance: input.confiance, createdBy: user.id,
    })
    revalidatePath(`/meetings/${reportId}/pv/validation`)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function deleteAddedPointAction(
  reportId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  try {
    await deleteReportAddedPoint(reportId, id)
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
  invite = true,
  diffusion = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireManagerOrAdmin()
  const n = name.trim()
  if (!n) return { ok: false, error: 'Nom vide.' }
  try {
    const report = await getSiteReport(reportId)
    if (!report) return { ok: false, error: 'Réunion introuvable' }
    const participants = [...(report.participants ?? []), { name: n, role: role.trim() || null, kind: 'person' as const, presence, invite, diffusion }]
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
  invite = true,
  diffusion = false,
  contactId?: string | null, // lien OPTIONNEL vers un contact réel (mig 137/138)
  timeToCorrectMs?: number | null, // temps passé côté client (mig 140)
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const n = name.trim()
  if (!n) return { ok: false, error: 'Nom vide.' }
  try {
    const report = await getSiteReport(reportId)
    if (!report) return { ok: false, error: 'Réunion introuvable' }
    const participants = [...(report.participants ?? [])]
    if (index < 0 || index >= participants.length) return { ok: false, error: 'Participant introuvable.' }
    const prev = participants[index] // AVANT mutation → diffs (capture passive)
    const r2 = role.trim() || null
    participants[index] = { ...prev, name: n, role: r2, presence, invite, diffusion, contactId: contactId || undefined }
    const { error } = await createAdminClient().from('site_reports').update({ participants }).eq('id', reportId)
    if (error) throw new Error(error.message)
    // Capture passive des corrections (mig 139, best-effort) : organisme/présence/nom/lien.
    const events: CorrectionEvent[] = []
    if ((prev.name ?? '') !== n) events.push({ entity: 'participant', field: 'nom', category: 'participant', op: 'edited', before: prev.name ?? null, after: n })
    if ((prev.role ?? null) !== r2) events.push({ entity: 'participant', field: 'organisme', category: 'organisation', op: 'edited', before: prev.role ?? null, after: r2 })
    if ((prev.presence ?? 'P') !== presence) events.push({ entity: 'participant', field: 'presence', category: 'presence', op: 'edited', before: prev.presence ?? 'P', after: presence })
    if ((prev.invite ?? true) !== invite) events.push({ entity: 'participant', field: 'invite', category: 'presence', op: 'edited', before: String(prev.invite ?? true), after: String(invite) })
    if ((prev.diffusion ?? false) !== diffusion) events.push({ entity: 'participant', field: 'diffusion', category: 'presence', op: 'edited', before: String(prev.diffusion ?? false), after: String(diffusion) })
    if ((prev.contactId ?? '') !== (contactId || '')) events.push({ entity: 'participant', field: 'contact', category: 'contact', op: 'edited', before: prev.contactId ?? null, after: contactId || null })
    await recordCorrections({ reportId, siteId: report.site_id, actorId: user.id, events: events.map((e) => ({ ...e, timeToCorrectMs: timeToCorrectMs ?? null })) })
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
  ordered: { id: string; source: 'intervention' | 'action' | 'report' }[],
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
  source: 'intervention' | 'action' | 'report',
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
