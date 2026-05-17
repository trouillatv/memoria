import { createAdminClient } from '@/lib/supabase/admin'

export interface ValidatedVoiceNote {
  id: string
  intervention_id: string
  storage_path: string
  mime_type: string
  duration_seconds: number
  transcription_corrected: string
  fragment_validated: string | null   // fragment mémoire validé — prioritaire pour l'affichage
  validated_at: string
  recorded_at: string
  recorded_by: string | null
  author_name: string | null
}

export interface SiteVoiceNotePreview {
  id: string
  intervention_id: string
  duration_seconds: number
  transcription_excerpt: string
  author_first_name: string | null
  recorded_at: string
}

// Notes validées par l'humain pour une intervention — jamais les transcriptions IA brutes.
export async function listValidatedVoiceNotesByIntervention(
  interventionId: string,
): Promise<ValidatedVoiceNote[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_voice_notes')
    .select(`
      id,
      intervention_id,
      storage_path,
      mime_type,
      duration_seconds,
      transcription_corrected,
      fragment_validated,
      validated_at,
      recorded_at,
      recorded_by,
      author:users!recorded_by(full_name)
    `)
    .eq('intervention_id', interventionId)
    .eq('status', 'validated')
    .order('recorded_at', { ascending: true })

  if (error) {
    console.error('[listValidatedVoiceNotesByIntervention]', error)
    return []
  }

  type Row = typeof data extends Array<infer R> ? R : never
  return (data ?? []).map((r: Row) => {
    const author = r.author as { full_name: string | null } | Array<{ full_name: string | null }> | null
    const fullName = Array.isArray(author) ? author[0]?.full_name : author?.full_name
    return {
      id: r.id,
      intervention_id: r.intervention_id,
      storage_path: r.storage_path,
      mime_type: r.mime_type,
      duration_seconds: r.duration_seconds,
      transcription_corrected: r.transcription_corrected ?? '',
      fragment_validated: (r as Record<string, unknown>).fragment_validated as string | null ?? null,
      validated_at: r.validated_at ?? '',
      recorded_at: r.recorded_at,
      recorded_by: r.recorded_by,
      author_name: fullName ?? null,
    }
  })
}

export interface VoiceNoteRow {
  id: string
  storage_path: string
  mime_type: string
  duration_seconds: number
  status: string
  transcription_raw: string | null
  transcription_corrected: string | null
  fragment_validated: string | null
  recorded_at: string
}

// Toutes les notes non-ignorées d'une intervention (mobile : écoute + fragment).
export async function listVoiceNotesByIntervention(
  interventionId: string,
): Promise<VoiceNoteRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_voice_notes')
    .select('id, storage_path, mime_type, duration_seconds, status, transcription_raw, transcription_corrected, fragment_validated, recorded_at')
    .eq('intervention_id', interventionId)
    .neq('status', 'ignored')
    .order('recorded_at', { ascending: false })

  if (error) {
    console.error('[listVoiceNotesByIntervention]', error)
    return []
  }
  return (data ?? []) as VoiceNoteRow[]
}

// Aperçu léger pour la page site — 5 dernières notes validées, extrait court.
export async function listRecentVoiceNotesBySite(
  siteId: string,
  limit = 5,
): Promise<SiteVoiceNotePreview[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_voice_notes')
    .select(`
      id,
      intervention_id,
      duration_seconds,
      transcription_corrected,
      recorded_at,
      author:users!recorded_by(full_name)
    `)
    .eq('site_id', siteId)
    .eq('status', 'validated')
    .order('recorded_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[listRecentVoiceNotesBySite]', error)
    return []
  }

  type Row = typeof data extends Array<infer R> ? R : never
  return (data ?? []).map((r: Row) => {
    const author = r.author as { full_name: string | null } | Array<{ full_name: string | null }> | null
    const fullName = Array.isArray(author) ? author[0]?.full_name : author?.full_name
    const firstName = fullName?.split(' ')[0] ?? null
    const text = r.transcription_corrected ?? ''
    return {
      id: r.id,
      intervention_id: r.intervention_id,
      duration_seconds: r.duration_seconds,
      transcription_excerpt: text.length > 80 ? text.slice(0, 80).trimEnd() + '…' : text,
      author_first_name: firstName,
      recorded_at: r.recorded_at,
    }
  })
}
