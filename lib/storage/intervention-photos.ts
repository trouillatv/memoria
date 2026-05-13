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

// Helpers métiers — préférer ces fonctions aux appels avec transform brut.
export async function getSignedPhotoUrlsThumb(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths, THUMB_TRANSFORM)
}

export async function getSignedPhotoUrlsFull(storagePaths: string[]): Promise<Map<string, string>> {
  return getSignedPhotoUrls(storagePaths)
}
