'use server'

// Preuve d'accès site — server action terrain (migration 070).
//
// Doctrine MemorIA :
//   - prise/restitution = événement d'accès (intervention_access_events).
//   - incident = anomalie RÉUTILISÉE (category='acces_bloque') + ligne miroir.
//     JAMAIS un système d'incidents parallèle.
//   - photo OPTIONNELLE (kind='access', SHA-256 comme les autres preuves).
//   - aucun champ détenteur ; created_by = audit interne (jamais surfacé UI).
//
// Limite MVP assumée (cohérente doctrine field) : la métadonnée texte
// (type/source/note) requiert la connectivité — pas de file offline ici.

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getIntervention, insertPhoto, createAnomaly } from '@/lib/db/interventions'
import { createAccessEvent } from '@/lib/db/intervention-access-events'
import { requireFieldAgent } from '@/lib/field/auth'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 Mo

const schema = z.object({
  intervention_id: z.string().uuid(),
  type: z.enum(['pickup', 'return', 'incident']),
  source: z.enum(['pc_securite', 'spi', 'accueil', 'autre']),
  note: z.string().trim().max(280).optional(),
  requires_return: z.boolean(),
  deferred: z.boolean(),
})

export async function recordAccessEventAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = schema.safeParse({
    intervention_id: formData.get('intervention_id'),
    type: formData.get('type'),
    source: formData.get('source') || 'autre',
    note: (formData.get('note') as string) || undefined,
    requires_return: formData.get('requires_return') !== 'false', // défaut true
    deferred: formData.get('deferred') === 'true',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }
  const input = parsed.data

  // Garde-fous métier (sobres) :
  //  - incident : on doit savoir ce qu'il s'est passé.
  //  - restitution différée ("continuer sans restitution") : note obligatoire.
  const note = input.note?.trim() ? input.note.trim() : null
  if (input.type === 'incident' && !note) {
    return { error: "Décrivez brièvement l'incident d'accès." }
  }
  if (input.type === 'return' && input.deferred && !note) {
    return { error: 'Une note est obligatoire pour différer la restitution.' }
  }

  const intervention = await getIntervention(input.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }

  const supabase = createAdminClient()

  // 1. Photo optionnelle — même pipeline intégrité que les autres preuves.
  let photoId: string | null = null
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
    if (!file.type.startsWith('image/')) return { error: 'Format non supporté' }

    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
    const ts = Date.now()
    const storagePath = `${input.intervention_id}/access-${ts}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${safeExt}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash('sha256').update(buffer).digest('hex')

    const { error: uploadErr } = await supabase.storage
      .from('intervention-photos')
      .upload(storagePath, buffer, { contentType: file.type, upsert: false })
    if (uploadErr) return { error: `Upload échoué : ${uploadErr.message}` }

    photoId = await insertPhoto({
      intervention_id: input.intervention_id,
      checklist_item_id: null,
      storage_path: storagePath,
      kind: 'access',
      caption: null,
      taken_by: auth.userId,
      sha256,
      mime_type: file.type,
      size_bytes: buffer.length,
      hash_origin: 'verified',
    })
  }

  // 2. Incident → anomalie RÉUTILISÉE (pas de système parallèle).
  //    category='acces_bloque' + note libre. Pas de sous-enum métier :
  //    les embeddings regrouperont sémantiquement plus tard.
  let anomalyId: string | null = null
  if (input.type === 'incident') {
    anomalyId = await createAnomaly({
      intervention_id: input.intervention_id,
      category: 'acces_bloque',
      description: note,
      reported_by: auth.userId,
    })
  }

  // 3. Événement d'accès (ligne miroir pour la section "Accès site").
  await createAccessEvent({
    intervention_id: input.intervention_id,
    type: input.type,
    source: input.source,
    note,
    photo_id: photoId,
    anomaly_id: anomalyId,
    requires_return: input.requires_return,
    deferred: input.deferred,
    created_by: auth.userId,
  })

  revalidatePath(`/m/intervention/${input.intervention_id}`)
  revalidatePath(`/interventions/${input.intervention_id}`)
  return { ok: true as const }
}
