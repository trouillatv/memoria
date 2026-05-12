'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  saveTenderVoiceNote,
  deleteTenderVoiceNote,
  getTender,
} from '@/lib/db/tenders'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * Voice note DG sur AO finalisé — doctrine V5 cas validé.
 *
 * Archive personnelle (pas une conversation). Lecture privée admin/manager.
 * Strictement restreint aux AO avec outcome NOT NULL.
 */

export interface SaveVoiceNoteFormResult {
  ok: boolean
  error?: string
}

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'not_authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') return { error: 'forbidden' }
  return { userId: user.id }
}

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB hard cap (3 min @ ~40kbps webm opus ~ 1MB, garde une marge)

export async function saveVoiceNoteAction(
  formData: FormData,
): Promise<SaveVoiceNoteFormResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const tenderId = formData.get('tenderId')
  const audio = formData.get('audio')
  const durationRaw = formData.get('durationSeconds')

  if (typeof tenderId !== 'string' || tenderId.length === 0) {
    return { ok: false, error: 'invalid_tender_id' }
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { ok: false, error: 'invalid_audio' }
  }
  if (audio.size > MAX_BYTES) {
    return { ok: false, error: 'audio_too_large' }
  }
  const duration = Number.parseInt(String(durationRaw ?? ''), 10)
  if (!Number.isFinite(duration) || duration < 1 || duration > 180) {
    return { ok: false, error: 'invalid_duration' }
  }

  // Garde-fou métier : la voice note n'a de sens que sur AO finalisé.
  const tender = await getTender(tenderId)
  if (!tender) return { ok: false, error: 'tender_not_found' }
  if (tender.outcome === null) {
    return { ok: false, error: 'tender_not_finalized' }
  }

  // Détection extension/contentType depuis le Blob.
  const type = (audio.type || '').toLowerCase()
  let ext = 'webm'
  let contentType = 'audio/webm'
  if (type.includes('mp4') || type.includes('m4a')) {
    ext = 'mp4'
    contentType = type || 'audio/mp4'
  } else if (type.includes('ogg')) {
    ext = 'ogg'
    contentType = type || 'audio/ogg'
  } else if (type.includes('webm')) {
    ext = 'webm'
    contentType = type || 'audio/webm'
  }

  try {
    await saveTenderVoiceNote({
      tenderId,
      audioBlob: audio,
      durationSeconds: duration,
      recordedBy: auth.userId,
      extension: ext,
      contentType,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'save_failed'
    return { ok: false, error: msg }
  }

  try {
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'tender',
      entityId: tenderId,
      action: 'updated',
      metadata: { kind: 'voice_note_saved', duration_seconds: duration },
    })
  } catch {
    // best-effort
  }

  revalidatePath(`/tenders/${tenderId}`)
  revalidatePath('/tenders/memoire')
  return { ok: true }
}

export async function deleteVoiceNoteAction(
  tenderId: string,
): Promise<SaveVoiceNoteFormResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  if (typeof tenderId !== 'string' || tenderId.length === 0) {
    return { ok: false, error: 'invalid_tender_id' }
  }

  try {
    await deleteTenderVoiceNote(tenderId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'delete_failed'
    return { ok: false, error: msg }
  }

  try {
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'tender',
      entityId: tenderId,
      action: 'updated',
      metadata: { kind: 'voice_note_deleted' },
    })
  } catch {
    // best-effort
  }

  revalidatePath(`/tenders/${tenderId}`)
  revalidatePath('/tenders/memoire')
  return { ok: true }
}
