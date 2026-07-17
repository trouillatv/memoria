'use server'

// « Pourquoi ? » — l'action serveur de la chaîne de provenance.
// Lecture seule ; la garde tenant vit dans le read model (fail-closed).

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getProvenance, type ProvenanceChain, type ProvenanceObjectType } from '@/lib/knowledge/provenance'

const Schema = z.object({
  type: z.enum(['action', 'deadline', 'decision']),
  id: z.string().uuid(),
})

export async function getProvenanceAction(input: {
  type: ProvenanceObjectType
  id: string
}): Promise<{ ok: true; chain: ProvenanceChain } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe')) {
    return { ok: false, error: 'Accès refusé' }
  }
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Requête invalide' }

  const chain = await getProvenance(parsed.data.type, parsed.data.id)
  if (!chain) return { ok: false, error: 'Origine non tracée pour cet élément.' }
  return { ok: true, chain }
}
