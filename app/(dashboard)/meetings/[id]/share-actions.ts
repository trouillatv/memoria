'use server'

// Création d'un lot d'actions à confier à une entreprise (QR / lien) — mig 148.
// Depuis le panneau « Qui fait quoi, pour quand » d'une réunion.
// Réservé managers / admins / chefs d'équipe. Retourne token + URL + QR + texte
// WhatsApp pré-rempli. Doctrine : recipient_label = entreprise, jamais salarié.

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'

// FRONTIÈRE M2C (5c). Avant : `site.org !== user.organization_id` — l'org par
// défaut du profil, fausse en multi-org. Désormais l'org vient du chantier
// (createDist : le site confié ; revoke : le site du lot résolu côté serveur).
import {
  createActionDistribution,
  listDistributedActionIds,
  revokeActionDistribution,
} from '@/lib/db/action-distribution'

export async function createActionDistributionAction(input: {
  reportId: string
  siteId: string
  recipientLabel: string
  /** Actions confiées + demande de preuve (photo requise pour clôturer). */
  actions: Array<{ actionId: string; requiresProofPhoto: boolean }>
  permanent?: boolean
}): Promise<
  | { ok: true; url: string; qrDataUrl: string; whatsappText: string; permanent: boolean }
  | { ok: false; error: string }
> {
  const recipientLabel = input.recipientLabel.trim()
  if (!recipientLabel) return { ok: false, error: 'Indiquez l\'entreprise destinataire' }
  if (recipientLabel.length > 80) return { ok: false, error: 'Nom d\'entreprise trop long' }

  const requested = input.actions.filter((a) => a.actionId)
  if (requested.length === 0) return { ok: false, error: 'Sélectionnez au moins une action' }

  // Frontière : le chantier confié doit m'appartenir (membership + rôle terrain).
  const access = await requireSiteWriteAccess(input.siteId)
  if (!access.ok) return { ok: false, error: 'Chantier introuvable' }

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', input.siteId)
    .maybeSingle()
  const siteRow = site as { id: string; name: string } | null
  if (!siteRow) return { ok: false, error: 'Chantier introuvable' }

  // Les actions appartiennent-elles bien à ce site ? (garde-fou périmètre)
  const requestedIds = requested.map((a) => a.actionId)
  const { data: ownActions } = await supabase
    .from('site_actions')
    .select('id')
    .eq('site_id', input.siteId)
    .in('id', requestedIds)
  const ownSet = new Set(((ownActions ?? []) as Array<{ id: string }>).map((r) => r.id))
  if (requestedIds.some((id) => !ownSet.has(id))) {
    return { ok: false, error: 'Une action n\'appartient pas à ce chantier' }
  }

  // Règle 0/1 entreprise par action : on exclut celles déjà confiées à un lot actif.
  const alreadyDistributed = new Set(await listDistributedActionIds(input.siteId))
  const freshActions = requested.filter((a) => !alreadyDistributed.has(a.actionId))
  if (freshActions.length === 0) {
    return { ok: false, error: 'Ces actions sont déjà confiées à une entreprise' }
  }

  const expiresAt = input.permanent ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

  let dist
  try {
    dist = await createActionDistribution({
      siteId: input.siteId,
      reportId: input.reportId,
      recipientLabel,
      createdBy: access.userId,
      expiresAt,
      actions: freshActions.map((a) => ({ actionId: a.actionId, requiresProofPhoto: a.requiresProofPhoto })),
    })
  } catch {
    return { ok: false, error: 'Erreur lors de la création du lien' }
  }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3001'
  const url = `${proto}://${host}/a/${dist.token}`

  let qrDataUrl = ''
  try {
    qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 })
  } catch {
    qrDataUrl = ''
  }

  const count = freshActions.length
  const whatsappText = [
    `Bonjour ${recipientLabel},`,
    ``,
    `Voici vos ${count} action${count > 1 ? 's' : ''} sur ${siteRow.name} :`,
    `→ ${url}`,
    ``,
    `Cochez ce qui est fait, ajoutez une photo, signez. Merci !`,
  ].join('\n')

  return { ok: true, url, qrDataUrl, whatsappText, permanent: !!input.permanent }
}

/** Révoque un lot (le lien cesse de fonctionner). Réservé managers/admins/chefs. */
export async function revokeActionDistributionAction(input: {
  distributionId: string
  reportId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Le lot appartient-il bien à cette réunion ? On résout SON site côté serveur,
  // puis la frontière porte sur ce site (jamais sur l'org par défaut du profil).
  const supabase = createAdminClient()
  const { data: dist } = await supabase
    .from('action_distributions')
    .select('id, report_id, site_id')
    .eq('id', input.distributionId)
    .maybeSingle()
  const row = dist as { id: string; report_id: string | null; site_id: string } | null
  if (!row || row.report_id !== input.reportId) return { ok: false, error: 'Lot introuvable' }

  const access = await requireSiteWriteAccess(row.site_id)
  if (!access.ok) return { ok: false, error: 'Lot introuvable' }

  try {
    await revokeActionDistribution(input.distributionId, access.userId)
  } catch {
    return { ok: false, error: 'Échec de la révocation' }
  }
  revalidatePath(`/meetings/${input.reportId}`)
  return { ok: true }
}
