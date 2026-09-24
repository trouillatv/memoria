'use server'

import { after } from 'next/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getSiteById } from '@/lib/db/sites'
import { requireOrganizationRole } from '@/lib/auth/memberships'
import { createDocumentCollection, listDocumentCollections, listDocumentsForTarget } from '@/lib/db/documents'
import { CONTRACTUAL_DOCUMENT_TYPE_VALUES } from './contractual-document-types'
import type { UploadDocumentResult } from '@/app/(dashboard)/documents/actions'

async function ensureSiteCollection(siteId: string): Promise<string> {
  const collections = await listDocumentCollections()
  const existing = collections.find((c) => c.scope_type === 'site' && c.scope_id === siteId)
  if (existing) return existing.id
  return createDocumentCollection({
    name: 'Documents chantier',
    scope_type: 'site',
    scope_id: siteId,
  })
}

export async function uploadSiteDocumentAction(
  siteId: string,
  formData: FormData,
): Promise<UploadDocumentResult> {
  try {
    const site = await getSiteById(siteId)
    if (!site?.organization_id) {
      return { ok: false, error: 'Chantier introuvable' }
    }
    // GARDE SERVEUR — appartenance ET rôle manager/admin DANS l'organisation du
    // chantier, AVANT tout effet de bord : ensureSiteCollection() peut créer une
    // collection ("Documents chantier") dès qu'aucune n'existe encore, et cette
    // création n'est protégée que par l'appartenance (pas le rôle). Sans ce
    // contrôle ici, un membre sans droit d'écriture pourrait déclencher cette
    // création avant le refus, tardif, de uploadDocumentAction.
    const membership = await requireOrganizationRole(site.organization_id, ['manager', 'admin'])
    if (!membership.ok) {
      return { ok: false, error: membership.error }
    }

    const { uploadDocumentAction } = await import('@/app/(dashboard)/documents/actions')
    const collectionId = await ensureSiteCollection(siteId)
    const fd = new FormData()
    const file = formData.get('file')
    if (file) fd.set('file', file)
    fd.set('collection_id', collectionId)
    fd.set('document_type', String(formData.get('document_type') || 'preuve'))
    fd.set('visibility_level', String(formData.get('visibility_level') || 'manager'))
    fd.set('target_type', 'site')
    fd.set('target_id', siteId)
    fd.set('embed', String(formData.get('embed') || 'true'))
    fd.set('memory_tier', String(formData.get('memory_tier') || 'consultable'))
    const effectiveDate = formData.get('effective_date')?.toString()
    if (effectiveDate) fd.set('effective_date', effectiveDate)
    const versionDecision = formData.get('version_decision')?.toString()
    if (versionDecision) fd.set('version_decision', versionDecision)
    const result = await uploadDocumentAction(fd)
    if (result.ok) {
      revalidatePath(`/sites/${siteId}`, 'page')
    }
    return result
  } catch (e) {
    console.error('[uploadSiteDocumentAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
}

/** Liste les documents ACTIFS actuellement rattachés à ce chantier, pour le
 *  sélecteur « Remplace un document existant ? » du dialogue Document
 *  contractuel (P0-1B2 revue FIX_REQUIRED, Vincent 2026-09-24, tâche 4).
 *  Réutilise listDocumentsForTarget, qui exclut déjà `superseded`/supprimés
 *  (P0-1B2 tâche 2) — jamais proposer de remplacer une version déjà remplacée. */
// `documentType` (P0-1B2 revue FIX_REQUIRED, Vincent 2026-09-24, correction 1)
// restreint la liste aux documents de la MÊME nature que celle actuellement
// sélectionnée dans le formulaire : une chaîne de versions ne peut relier que
// des documents métier compatibles (jamais un CCTP proposé comme remplaçant
// d'un PV historique via ce sélecteur).
export async function listSiteDocumentsForReplaceAction(
  siteId: string,
  documentType: string,
): Promise<Array<{ id: string; filename: string; document_type: string }>> {
  const site = await getSiteById(siteId)
  if (!site?.organization_id) return []
  const membership = await requireOrganizationRole(site.organization_id, ['manager', 'admin'])
  if (!membership.ok) return []
  const docs = await listDocumentsForTarget('site', siteId)
  return docs
    .filter((d) => d.document_type === documentType)
    .map((d) => ({ id: d.id, filename: d.filename, document_type: d.document_type }))
}

// Document contractuel (P0-1, Vincent 2026-09-23) — action DÉDIÉE, distincte de
// uploadSiteDocumentAction. Le flux générique "Document PDF" tolère un
// document_type absent en le repliant sur 'preuve' ; ce repli est exactement
// ce qui a produit un CCTP importé comme "preuve" en recette (2026-09-23,
// review ChatGPT sur le rapport P0-1). Ici, un document_type absent ou hors
// de la liste contractuelle est un refus, jamais une valeur par défaut.
export async function uploadSiteContractualDocumentAction(
  siteId: string,
  formData: FormData,
): Promise<UploadDocumentResult> {
  try {
    const documentType = formData.get('document_type')?.toString()
    if (!documentType || !CONTRACTUAL_DOCUMENT_TYPE_VALUES.includes(documentType)) {
      return { ok: false, error: 'Nature de document contractuel invalide' }
    }

    const site = await getSiteById(siteId)
    if (!site?.organization_id) {
      return { ok: false, error: 'Chantier introuvable' }
    }
    // Même garde qu'uploadSiteDocumentAction : appartenance ET rôle
    // manager/admin DANS l'organisation du chantier, AVANT tout effet de
    // bord (ensureSiteCollection peut créer une collection).
    const membership = await requireOrganizationRole(site.organization_id, ['manager', 'admin'])
    if (!membership.ok) {
      return { ok: false, error: membership.error }
    }

    const { uploadDocumentAction } = await import('@/app/(dashboard)/documents/actions')
    const collectionId = await ensureSiteCollection(siteId)
    const fd = new FormData()
    const file = formData.get('file')
    if (file) fd.set('file', file)
    fd.set('collection_id', collectionId)
    fd.set('document_type', documentType)
    fd.set('visibility_level', String(formData.get('visibility_level') || 'manager'))
    fd.set('target_type', 'site')
    fd.set('target_id', siteId)
    fd.set('embed', String(formData.get('embed') || 'true'))
    fd.set('memory_tier', String(formData.get('memory_tier') || 'consultable'))
    const effectiveDate = formData.get('effective_date')?.toString()
    if (effectiveDate) fd.set('effective_date', effectiveDate)
    const versionDecision = formData.get('version_decision')?.toString()
    if (versionDecision) fd.set('version_decision', versionDecision)
    const replacesDocumentId = formData.get('replaces_document_id')?.toString()
    if (replacesDocumentId) fd.set('replaces_document_id', replacesDocumentId)
    const result = await uploadDocumentAction(fd)
    if (result.ok) {
      revalidatePath(`/sites/${siteId}`, 'page')
    }
    return result
  } catch (e) {
    console.error('[uploadSiteContractualDocumentAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
}

export async function importSiteHistoricalPvAction(
  siteId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  try {
    const { uploadDocumentAction } = await import('@/app/(dashboard)/documents/actions')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Non authentifié' }
    const role = await getUserRoleById(user.id)
    if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Permissions insuffisantes' }

    const collectionId = await ensureSiteCollection(siteId)
    const fd = new FormData()
    const file = formData.get('file')
    if (file) fd.set('file', file)
    fd.set('collection_id', collectionId)
    fd.set('document_type', 'historical_visit_report')
    fd.set('visibility_level', 'manager')
    fd.set('target_type', 'site')
    fd.set('target_id', siteId)
    fd.set('embed', 'false')
    fd.set('memory_tier', 'froide')
    const effectiveDate = formData.get('effective_date')?.toString()
    if (effectiveDate) fd.set('effective_date', effectiveDate)

    const result = await uploadDocumentAction(fd)
    if (!result.ok || !result.documentId) return { ok: false, error: result.error ?? 'Import impossible' }

    const secret = process.env.CRON_SECRET
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
    const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const extractionUrl = `${proto}://${host}/api/extraction/historical-pv`

    if (secret) {
      after(async () => {
        try {
          await fetch(extractionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-trigger': secret },
            body: JSON.stringify({ documentId: result.documentId, userId: user.id, siteId }),
          })
        } catch (e) {
          console.error('importSiteHistoricalPvAction trigger error:', e)
        }
      })
    }

    revalidatePath(`/sites/${siteId}`, 'page')
    return { ok: true, documentId: result.documentId }
  } catch (e) {
    console.error('[importSiteHistoricalPvAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
}

export async function importSiteEvidenceAction(
  siteId: string,
  formData: FormData,
): Promise<
  | { ok: true; created: number; skippedDuplicates: number; firstVisitId?: string }
  | { ok: false; error: string }
> {
  try {
    const { importVisitAction } = await import('@/app/(field)/m/import/import-actions')
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('source', 'upload')
    for (const file of formData.getAll('files')) {
      fd.append('files', file)
    }
    const result = await importVisitAction(fd)
    if (!result.ok) return result
    revalidatePath(`/sites/${siteId}`, 'page')
    return {
      ok: true,
      created: result.created,
      skippedDuplicates: result.skippedDuplicates,
      firstVisitId: result.sessions[0]?.reportId,
    }
  } catch (e) {
    console.error('[importSiteEvidenceAction]', e)
    return { ok: false, error: 'Une erreur inattendue est survenue.' }
  }
}
