import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'intervention-voice-notes'
const TTL_SEC = 3600

export async function getSignedVoiceNoteUrl(storagePath: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, TTL_SEC)
  if (error) {
    console.error('[getSignedVoiceNoteUrl]', error)
    return null
  }
  return data.signedUrl
}

export async function getSignedVoiceNoteUrls(
  storagePaths: string[],
): Promise<Map<string, string>> {
  if (storagePaths.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(storagePaths, TTL_SEC)
  if (error) {
    console.error('[getSignedVoiceNoteUrls]', error)
    return new Map()
  }
  const map = new Map<string, string>()
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl)
  }
  return map
}
