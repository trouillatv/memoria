'use server'

// Génération de token d'intervention depuis le briefing du soir.
// Réservé aux managers et admins.
// Retourne le token + l'URL publique + le texte WhatsApp pré-rempli.

import { headers } from 'next/headers'
import { createInterventionToken } from '@/lib/db/intervention-tokens'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'

export async function generateInterventionTokenAction(input: {
  interventionId: string
  companyName: string
  note?: string
}): Promise<
  | { ok: true; token: string; url: string; whatsappText: string }
  | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') {
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

  // Expiration : 48h à partir de maintenant
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString()

  const note = input.note?.trim() || `Sous-traitant : ${input.companyName}`

  let tok
  try {
    tok = await createInterventionToken({
      interventionId: input.interventionId,
      createdBy: user.id,
      expiresAt,
      note,
    })
  } catch {
    return { ok: false, error: 'Erreur lors de la création du lien' }
  }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3001'
  const url = `${proto}://${host}/i/${tok.token}`

  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (!v) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  type MissionRow = { name: string; site: { name: string } | { name: string }[] | null }
  const mission = pickOne(intv.mission as MissionRow | MissionRow[] | null)
  const site = pickOne(mission?.site ?? null)
  const missionName = mission?.name ?? 'Intervention'
  const siteName = site?.name ?? ''

  const whatsappText = [
    `Bonjour,`,
    ``,
    `Voici votre intervention${siteName ? ` sur ${siteName}` : ''} :`,
    `${missionName}`,
    ``,
    `→ ${url}`,
    ``,
    `Ce lien vous permet de confirmer la réalisation. Valable 48h.`,
  ].join('\n')

  return { ok: true, token: tok.token, url, whatsappText }
}
