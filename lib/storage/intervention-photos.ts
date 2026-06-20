import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'intervention-photos'
const SIGNED_URL_TTL_SEC = 3600 // 1h

export interface PhotoTransform {
  width?: number
  height?: number
  quality?: number
  resize?: 'cover' | 'contain' | 'fill'
}

// Preset thumbnail — gros gain bande passante sur listes et grilles.
const THUMB_TRANSFORM: PhotoTransform = { width: 400, height: 400, resize: 'cover', quality: 70 }

// V5.1.3 — Preset SANS crop (doctrine Vincent 2026-05-14) :
// "Pas de crop agressif. Préférer voir des bandes plutôt que tronquer la
// vérité spatiale. La rugosité du terrain est l'information." Aspect ratio
// natif préservé (width seul → height calculée par Supabase). À utiliser pour
// vignettes page Site (Activité récente, Anomalies).
const THUMB_PRESERVE_AR_NARROW: PhotoTransform = { width: 200, quality: 75 }
const THUMB_PRESERVE_AR_MEDIUM: PhotoTransform = { width: 400, quality: 75 }

function buildOptions(transform?: PhotoTransform) {
  if (!transform) return undefined
  return { transform }
}

export async function getSignedPhotoUrl(
  storagePath: string,
  transform?: PhotoTransform,
): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC, buildOptions(transform))
  if (error) {
    console.error('[getSignedPhotoUrl]', error)
    return null
  }
  return data.signedUrl
}

export async function getSignedPhotoUrls(
  storagePaths: string[],
  transform?: PhotoTransform,
): Promise<Map<string, string>> {
  if (storagePaths.length === 0) return new Map()
  const supabase = createAdminClient()
  // L'API batch (createSignedUrls) ne supporte pas `transform`. Si un transform
  // est demandé, on lance des signatures individuelles en parallèle. Sinon batch.
  if (transform) {
    const results = await Promise.all(
      storagePaths.map(async (path) => {
        const { data, error } = await supabase
          .storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SEC, buildOptions(transform))
        if (error || !data) return [path, null] as const
        return [path, data.signedUrl] as const
      })
    )
    const map = new Map<string, string>()
    for (const [path, url] of results) {
      if (url) map.set(path, url)
    }
    return map
  }
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrls(storagePaths, SIGNED_URL_TTL_SEC)
  if (error) {
    console.error('[getSignedPhotoUrls]', error)
    return new Map()
  }
  const map = new Map<string, string>()
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl)
  }
  return map
}

// Data URLs base64 (pour EMBARQUER les images, ex. @react-pdf qui ne sait pas
// fetcher une URL signée au rendu). On télécharge la version transformée (légère)
// côté serveur, puis on encode. Une image qui échoue est simplement omise.
export async function getPhotoDataUrls(
  storagePaths: string[],
  transform?: PhotoTransform,
): Promise<Map<string, string>> {
  const signed = await getSignedPhotoUrls(storagePaths, transform)
  const out = new Map<string, string>()
  await Promise.all(
    [...signed.entries()].map(async ([path, url]) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const ct = res.headers.get('content-type') || 'image/jpeg'
        // @react-pdf ne rend que du raster. On SAUTE le SVG (placeholders de seed
        // ou erreurs de transform) → jamais de crash de rendu.
        if (!/^image\/(jpe?g|png|webp|gif)$/i.test(ct)) return
        const buf = Buffer.from(await res.arrayBuffer())
        out.set(path, `data:${ct};base64,${buf.toString('base64')}`)
      } catch {
        /* image illisible → omise (jamais de cadre vide) */
      }
    }),
  )
  return out
}

const CR_EMBED_TRANSFORM: PhotoTransform = { width: 1000, quality: 72 }
/** Photos embarquées pour le CR (data URLs, taille raisonnable). */
export async function getPhotoDataUrlsForCr(storagePaths: string[]): Promise<Map<string, string>> {
  return getPhotoDataUrls(storagePaths, CR_EMBED_TRANSFORM)
}

// Helpers métiers — préférer ces fonctions aux appels avec transform brut.
export async function getSignedPhotoUrlsThumb(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths, THUMB_TRANSFORM)
}

export async function getSignedPhotoUrlsFull(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths)
}

// V5.1.3 — Vignettes page Site, aspect ratio préservé (jamais crop).
export async function getSignedPhotoUrlsNarrow(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths, THUMB_PRESERVE_AR_NARROW)
}

export async function getSignedPhotoUrlsMedium(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths, THUMB_PRESERVE_AR_MEDIUM)
}
