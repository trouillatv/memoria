'use server'

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAnomaly } from '@/lib/db/interventions'
import {
  findOrCreateSpontaneousIntervention,
  NoActiveTeamError,
} from '@/lib/db/spontaneous-intervention'
import { requireFieldAgent } from '@/lib/field/auth'

// V5.1 — Server action : dépôt photo libre sur un site (Slice 1).
//
// Différence avec uploadPhotoMobileAction (legacy intervention-centric) :
//   - input = siteId (pas intervention_id) + intent (passage|anomaly) + client_uuid
//   - find-or-create d'une intervention "spontanée" (fenêtre 4h, team de l'agent)
//   - idempotence garantie via client_uuid (migration 051) :
//       * pré-check : si client_uuid déjà ingéré → return existing photoId, no-op
//       * post-catch sur UNIQUE violation 23505 → cleanup orphan + idempotent return
//   - si intent='anomaly' ET photo nouvellement insérée → crée intervention_anomalies
//     avec category='autre' (décision Vincent 2026-05-14 : pas de catégorisation
//     demandée à Joseph au dépôt, Maeva enrichit plus tard si besoin)

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB — cohérent avec uploadPhotoMobileAction

const uploadSpontaneousSchema = z.object({
  site_id: z.string().uuid(),
  intent: z.enum(['passage', 'anomaly']),
  client_uuid: z.string().uuid(),
  client_timestamp: z.string().datetime().nullable().optional(),
})

export async function uploadSpontaneousTraceAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Photo manquante' }
  if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
  if (!file.type.startsWith('image/')) return { error: 'Format non supporté' }

  const clientTimestampRaw = formData.get('client_timestamp') as string | null
  const client_timestamp = clientTimestampRaw && clientTimestampRaw !== '' ? clientTimestampRaw : null

  const parsed = uploadSpontaneousSchema.safeParse({
    site_id: formData.get('site_id'),
    intent: formData.get('intent'),
    client_uuid: formData.get('client_uuid'),
    client_timestamp,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { site_id, intent, client_uuid } = parsed.data
  const supabase = createAdminClient()

  // ───────────────────────────────────────────────────────────────────────
  // Idempotence pré-check : si client_uuid déjà ingéré, return existing photo.
  // ───────────────────────────────────────────────────────────────────────
  const { data: alreadyIngested } = await supabase
    .from('intervention_photos')
    .select('id, intervention_id')
    .eq('client_uuid', client_uuid)
    .maybeSingle()
  if (alreadyIngested) {
    return {
      ok: true as const,
      photoId: alreadyIngested.id,
      interventionId: alreadyIngested.intervention_id,
      idempotent: true,
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Find-or-create intervention spontanée (fenêtre 4h sur team de l'agent).
  // ───────────────────────────────────────────────────────────────────────
  let intervention: { id: string }
  let interventionWasCreated: boolean
  try {
    const result = await findOrCreateSpontaneousIntervention(auth.userId, site_id)
    intervention = result.intervention
    interventionWasCreated = result.created
  } catch (err) {
    if (err instanceof NoActiveTeamError) {
      // Cas limite : agent sans team active. UX descriptive.
      return { error: err.message }
    }
    throw err
  }

  // ───────────────────────────────────────────────────────────────────────
  // Upload bucket + intégrité SHA-256 (pattern identique à uploadPhotoMobileAction).
  // ───────────────────────────────────────────────────────────────────────
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
  const ts = Date.now()
  // kind dans le storage path : 'passage' ou 'anomaly' (V5.1 photo_kind élargi)
  const kind = intent === 'anomaly' ? 'anomaly' : 'passage'
  const storagePath = `${intervention.id}/${kind}-${ts}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const { error: uploadErr } = await supabase.storage
    .from('intervention-photos')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (uploadErr) return { error: `Upload échoué : ${uploadErr.message}` }

  // ───────────────────────────────────────────────────────────────────────
  // Insert intervention_photos avec client_uuid (idempotence DB via index UNIQUE
  // partial migration 051). Pattern : INSERT direct + catch 23505 = filet de
  // sécurité pour race condition entre 2 retries simultanés.
  // ───────────────────────────────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase
    .from('intervention_photos')
    .insert({
      intervention_id: intervention.id,
      checklist_item_id: null,
      storage_path: storagePath,
      kind,
      caption: null,
      taken_by: auth.userId,
      sha256,
      mime_type: file.type,
      size_bytes: buffer.length,
      client_timestamp,
      hash_origin: 'verified' as const,
      client_uuid,
    })
    .select('id')
    .single()

  if (insertErr) {
    // UNIQUE violation sur client_uuid → conflit (un retry simultané a gagné).
    // Cleanup le fichier qu'on vient d'uploader (orphan) + return idempotent.
    if (insertErr.code === '23505') {
      await supabase.storage.from('intervention-photos').remove([storagePath]).catch(() => {})
      const { data: existing } = await supabase
        .from('intervention_photos')
        .select('id, intervention_id')
        .eq('client_uuid', client_uuid)
        .single()
      return {
        ok: true as const,
        photoId: existing?.id ?? null,
        interventionId: existing?.intervention_id ?? intervention.id,
        idempotent: true,
      }
    }
    // Autre erreur DB → cleanup orphan + propage
    await supabase.storage.from('intervention-photos').remove([storagePath]).catch(() => {})
    return { error: `Insertion échouée : ${insertErr.message}` }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Anomalie chaînée si intent='anomaly' ET photo nouvellement insérée.
  // Idempotence : si on est dans cette branche, c'est qu'on a passé l'idempotence
  // pré-check ET la branche 23505 → la photo est nouvelle, on crée donc
  // l'anomalie. Pas de double anomalie possible : la prochaine fois que ce
  // client_uuid arrive, le pré-check renverra l'existing photoId sans rejouer.
  // ───────────────────────────────────────────────────────────────────────
  if (intent === 'anomaly') {
    await createAnomaly({
      intervention_id: intervention.id,
      // Décision Vincent 2026-05-14 : pas de catégorisation à Joseph au dépôt.
      // Maeva enrichira plus tard via la page intervention/dashboard si besoin.
      category: 'autre',
      category_other: null,
      description: null,
      reported_by: auth.userId,
    })
  }

  revalidatePath(`/m/site/${site_id}`)
  revalidatePath(`/sites/${site_id}`)
  if (interventionWasCreated) {
    // Nouvelle intervention spontanée — invalider les vues qui touchent les interventions
    revalidatePath('/m')
  }

  return {
    ok: true as const,
    photoId: inserted.id,
    interventionId: intervention.id,
    idempotent: false,
  }
}
