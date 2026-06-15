'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createSiteDelivery, setSiteDeliveryPhoto } from '@/lib/db/site-delivery'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 Mo — cohérent avec les autres uploads

const schema = z.object({
  siteId: z.string().uuid(),
  deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  supplier: z.string().trim().max(200).nullable(),
  reference: z.string().trim().max(120).nullable(),
  zone: z.string().trim().max(200).nullable(),
  material: z.string().trim().max(200).nullable(),
  quantity: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(500).nullable(),
})

/** Champ texte de FormData → string|null (vide = null). */
function field(formData: FormData, key: string): string | null {
  const v = formData.get(key)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export async function recordDeliveryAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const parsed = schema.safeParse({
    siteId: formData.get('siteId'),
    deliveredOn: formData.get('deliveredOn'),
    supplier: field(formData, 'supplier'),
    reference: field(formData, 'reference'),
    zone: field(formData, 'zone'),
    material: field(formData, 'material'),
    quantity: field(formData, 'quantity'),
    note: field(formData, 'note'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  // Les bons de livraison sont pilotés côté superviseur, pas par le terrain.
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  const { siteId, deliveredOn, supplier, reference, zone, material, quantity, note } = parsed.data

  const id = await createSiteDelivery({
    siteId,
    deliveredOn,
    supplier,
    reference,
    zone,
    material,
    quantity,
    note,
    userId: user.id,
  })

  // Photo du bon de livraison (optionnelle).
  const file = formData.get('photo')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
    if (!file.type.startsWith('image/')) return { error: 'Format de photo non supporté' }

    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
    const path = `site-deliveries/${id}/bon-${Date.now()}.${safeExt}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const supabase = createAdminClient()
    const { error: uploadErr } = await supabase.storage
      .from('intervention-photos')
      .upload(path, buffer, { contentType: file.type, upsert: false })
    if (uploadErr) return { error: `Upload du bon échoué : ${uploadErr.message}` }

    await setSiteDeliveryPhoto(id, path)
  }

  revalidatePath(`/sites/${siteId}/livraisons`)
  return { ok: true }
}
