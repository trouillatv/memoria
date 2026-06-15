'use server'

// Génération de lien d'intervention sécurisé depuis le briefing du soir.
// Réservé aux managers et admins.
// Retourne le token + l'URL publique + le texte WhatsApp pré-rempli.

import { headers } from 'next/headers'
import { createInterventionToken, listDelegatedItemIds } from '@/lib/db/intervention-tokens'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'

export async function generateInterventionTokenAction(input: {
  interventionId: string
  recipientLabel?: string
  note?: string
  permanent?: boolean
  /** Périmètre : items de checklist confiés à l'externe. Vide = intervention entière. */
  checklistItemIds?: string[]
}): Promise<
  | { ok: true; token: string; url: string; whatsappText: string; permanent: boolean }
  | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }

  // Vérification que l'intervention appartient à l'org de l'utilisateur
  const supabase = createAdminClient()
  const { data: intv } = await supabase
    .from('interventions')
    .select('id, organization_id, mission:missions!inner(name, site:sites!inner(name))')
    .eq('id', input.interventionId)
    .maybeSingle()

  if (!intv) return { ok: false, error: 'Intervention introuvable' }

  // Expiration : 48h à partir de maintenant, ou null si permanent
  const expiresAt = input.permanent
    ? null
    : new Date(Date.now() + 48 * 3600 * 1000).toISOString()

  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (!v) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  type MissionRow = { name: string; site: { name: string } | { name: string }[] | null }
  const mission = pickOne(intv.mission as MissionRow | MissionRow[] | null)
  const site = pickOne(mission?.site ?? null)
  const missionName = mission?.name ?? 'Intervention'
  const siteName = site?.name ?? ''

  const recipientLabel = input.recipientLabel?.trim() || null
  const note = input.note?.trim() || [recipientLabel, missionName, siteName].filter(Boolean).join(' — ')

  // Périmètre : valider que les items appartiennent à l'intervention et ne sont
  // pas déjà confiés à un autre externe actif (règle 0/1 exécutant par tâche).
  const requestedItems = Array.from(new Set((input.checklistItemIds ?? []).filter(Boolean)))
  if (requestedItems.length > 0) {
    const { data: ownItems } = await supabase
      .from('intervention_checklist_items')
      .select('id')
      .eq('intervention_id', input.interventionId)
      .in('id', requestedItems)
    const ownSet = new Set(((ownItems ?? []) as Array<{ id: string }>).map((r) => r.id))
    if (requestedItems.some((id) => !ownSet.has(id))) {
      return { ok: false, error: 'Tâche invalide pour cette intervention' }
    }
    const alreadyDelegated = new Set(await listDelegatedItemIds(input.interventionId))
    if (requestedItems.some((id) => alreadyDelegated.has(id))) {
      return { ok: false, error: 'Une de ces tâches est déjà confiée à un autre externe' }
    }
  }

  let tok
  try {
    tok = await createInterventionToken({
      interventionId: input.interventionId,
      createdBy: user.id,
      expiresAt,
      note,
      recipientLabel,
      checklistItemIds: requestedItems,
    })
  } catch {
    return { ok: false, error: 'Erreur lors de la création du lien' }
  }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3001'
  const url = `${proto}://${host}/i/${tok.token}`

  const greeting = recipientLabel ? `Bonjour ${recipientLabel},` : `Bonjour,`

  const expiryLine = input.permanent
    ? `Ce lien vous permet de confirmer la réalisation. Pas de date d'expiration.`
    : `Ce lien vous permet de confirmer la réalisation. Valable 48h.`

  const whatsappText = [
    greeting,
    ``,
    `Voici votre intervention${siteName ? ` sur ${siteName}` : ''} :`,
    `${missionName}`,
    ``,
    `→ ${url}`,
    ``,
    expiryLine,
  ].join('\n')

  return { ok: true, token: tok.token, url, whatsappText, permanent: !!input.permanent }
}
