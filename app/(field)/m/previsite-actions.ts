'use server'

// Démarrage TERRAIN d'une prévisite AO depuis l'accueil /m (Vincent 2026-06-29) :
// créer vite l'affaire + le lieu, lancer la visite, filer capturer. Le bureau sert
// à relire / rattacher l'AO / répondre — pas le téléphone. On ne met PAS tout le
// module AO dans /m, juste le DÉMARRAGE. Auth field (admin/manager autorisés).

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { createProspectDossier } from '@/lib/db/dossiers'
import { createVisit } from '@/lib/db/visits'

const schema = z.object({
  affaireName: z.string().trim().min(1).max(200),
  siteName: z.string().trim().min(1).max(200),
  clientName: z.string().trim().max(200).optional(),
})

export async function startPrevisiteAoAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; siteId: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Nom de l’affaire et du site requis' }
  try {
    const { siteId } = await createProspectDossier({
      name: parsed.data.affaireName,
      siteName: parsed.data.siteName,
      clientName: parsed.data.clientName || null,
    })
    // Lance la visite tout de suite : le dossier (phase prospect) est stampé
    // automatiquement sur le report → la capture nourrit l'affaire. Cf. mig 172.
    await createVisit({ siteId, origin: 'spontaneous', createdBy: auth.userId })
    return { ok: true, siteId }
  } catch {
    return { ok: false, error: 'Échec de la création' }
  }
}
