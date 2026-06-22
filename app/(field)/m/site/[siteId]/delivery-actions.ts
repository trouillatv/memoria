'use server'

// Déclaration de LIVRAISON / ÉVACUATION depuis le terrain (Vincent, pilote BTP).
// Le gars dans le camion coche ce qui est livré/évacué + photo, en fin de journée.
// On lève la restriction « superviseur only » du desktop : ici, requireFieldAgent
// autorise le chef d'équipe. Réutilise le même moteur que les bons côté bureau.
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldAgent } from '@/lib/field/auth'
import { createSiteDelivery, setSiteDeliveryPhoto } from '@/lib/db/site-delivery'
import { todayLocalIso } from '@/lib/time/local-date'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

const schema = z.object({
  siteId: z.string().uuid(),
  supplier: z.string().trim().max(200).nullable(),
  material: z.string().trim().max(200).nullable(),
  zone: z.string().trim().max(200).nullable(),
  quantity: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(500).nullable(),
})

function field(formData: FormData, key: string): string | null {
  const v = formData.get(key)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export async function recordDeliveryFieldAction(formData: FormData): Promise<{ ok: true } | { error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { error: auth.error }

  const parsed = schema.safeParse({
    siteId: formData.get('siteId'),
    supplier: field(formData, 'supplier'),
    material: field(formData, 'material'),
    zone: field(formData, 'zone'),
    quantity: field(formData, 'quantity'),
    note: field(formData, 'note'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const { siteId, supplier, material, zone, quantity, note } = parsed.data
  if (!supplier && !material && !note) return { error: 'Indiquez au moins le fournisseur, le produit ou une note.' }

  const id = await createSiteDelivery({
    siteId, deliveredOn: todayLocalIso(), supplier, reference: null, zone, material, quantity, note, userId: auth.userId,
  })

  const file = formData.get('photo')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
    if (!file.type.startsWith('image/')) return { error: 'Format de photo non supporté' }
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
    const path = `site-deliveries/${id}/bon-${Date.now()}.${safeExt}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const supabase = createAdminClient()
    const { error: upErr } = await supabase.storage.from('intervention-photos').upload(path, buffer, { contentType: file.type, upsert: false })
    if (upErr) return { error: `Upload de la photo échoué : ${upErr.message}` }
    await setSiteDeliveryPhoto(id, path)
  }

  revalidatePath(`/m/site/${siteId}`)
  revalidatePath(`/sites/${siteId}/livraisons`)
  return { ok: true }
}
