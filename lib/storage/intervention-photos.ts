import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'intervention-photos'
const SIGNED_URL_TTL_SEC = 3600 // 1h

export async function getSignedPhotoUrl(storagePath: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SEC)
  if (error) {
    console.error('[getSignedPhotoUrl]', error)
    return null
  }
  return data.signedUrl
}

export async function getSignedPhotoUrls(storagePaths: string[]): Promise<Map<string, string>> {
  if (storagePaths.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(storagePaths, SIGNED_URL_TTL_SEC)
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
