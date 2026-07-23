'use server'

// « Nouveau chantier → première visite » depuis le terrain. Philosophie MemorIA :
// CAPTURER d'abord, structurer ensuite. On ne force pas à tout remplir avant : le
// nom suffit ; adresse et client sont facultatifs. Le dossier se complète au fur
// et à mesure. Le client obligatoire en base est résolu par un placeholder
// réutilisable tant qu'aucun n'est précisé. Auth field (chef_equipe/admin/manager).

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { getOrgId } from '@/lib/db/users'
import { createSite, findOrCreateClientByName, buildCanonicalSiteKey } from '@/lib/db/sites'
import { createVisit } from '@/lib/db/visits'

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  clientName: z.string().trim().max(200).optional(),
})

/** Client de repli quand aucun n'est précisé — « on rattachera plus tard ». */
const UNASSIGNED_CLIENT = 'Client à préciser'

export async function quickCreateSiteVisitAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; siteId: string; reportId: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Le nom du chantier est requis' }
  const { name, address, clientName } = parsed.data

  try {
    const resolvedClientName = clientName || UNASSIGNED_CLIENT
    const clientId = await findOrCreateClientByName(resolvedClientName)
    const canonicalKey = buildCanonicalSiteKey(resolvedClientName, name)
    const orgId = await getOrgId() // M3_TEMP_B — B-technique : getOrgId() jusqu'au sélecteur multi-org
    const siteId = await createSite({
      client_id: clientId,
      contract_id: null,
      name,
      address: address ?? null,
      canonical_site_key: canonicalKey,
      organization_id: orgId ?? undefined,
    })

    // Première visite lancée tout de suite — le panier terrain s'ouvre au retour
    // sur /m/site/{siteId}. Un chantier tout neuf → intention « première visite ».
    const reportId = await createVisit({ siteId, origin: 'spontaneous', createdBy: auth.userId, motive: 'premiere' })
    return { ok: true, siteId, reportId }
  } catch {
    return { ok: false, error: 'Échec de la création du chantier' }
  }
}

/**
 * Crée juste le CHANTIER (sans visite) — pour « Enregistrer une réunion » sur un
 * nouveau chantier : on veut le site, puis on ouvre l'enregistreur de réunion
 * dessus. Même logique de création rapide (nom requis, reste facultatif).
 */
export async function quickCreateSiteAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; siteId: string; siteName: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Le nom du chantier est requis' }
  const { name, address, clientName } = parsed.data

  try {
    const resolvedClientName = clientName || UNASSIGNED_CLIENT
    const clientId = await findOrCreateClientByName(resolvedClientName)
    const canonicalKey = buildCanonicalSiteKey(resolvedClientName, name)
    const orgId2 = await getOrgId() // M3_TEMP_B — B-technique : getOrgId() jusqu'au sélecteur multi-org
    const siteId = await createSite({
      client_id: clientId,
      contract_id: null,
      name,
      address: address ?? null,
      canonical_site_key: canonicalKey,
      organization_id: orgId2 ?? undefined,
    })
    return { ok: true, siteId, siteName: name }
  } catch {
    return { ok: false, error: 'Échec de la création du chantier' }
  }
}
