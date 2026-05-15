'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldAgent } from '@/lib/field/auth'
import { embedAndStoreTrace } from '@/lib/ai/embed-trace'

const BUCKET = 'intervention-voice-notes'

const uploadSchema = z.object({
  intervention_id: z.string().uuid(),
  duration_seconds: z.coerce.number().int().min(1).max(30),
  mime_type: z.string().default('audio/webm'),
})

function mimeToExt(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

// Même priorité que les embeddings : Google → OpenAI → vide
async function transcribeAudio(rawBuffer: ArrayBuffer, mimeType: string, ext: string): Promise<string> {
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return transcribeWithGemini(rawBuffer, mimeType)
  }
  if (process.env.OPENAI_API_KEY) {
    return transcribeWithWhisper(rawBuffer, mimeType, ext)
  }
  return ''
}

async function transcribeWithGemini(rawBuffer: ArrayBuffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY!
  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.0-flash'
  const base64 = Buffer.from(rawBuffer).toString('base64')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: 'Transcris cet audio en français. Retourne uniquement la transcription brute, sans explication ni ponctuation ajoutée.' },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function transcribeWithWhisper(rawBuffer: ArrayBuffer, mimeType: string, ext: string): Promise<string> {
  const whisperForm = new FormData()
  whisperForm.append('file', new Blob([rawBuffer], { type: mimeType }), `voice.${ext}`)
  whisperForm.append('model', 'whisper-1')
  whisperForm.append('language', 'fr')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: whisperForm,
  })

  if (!res.ok) throw new Error(`Whisper ${res.status}`)
  const { text } = (await res.json()) as { text: string }
  return text
}

// ---------------------------------------------------------------------------
// uploadVoiceNoteAction — upload + transcription Whisper en une passe
// Retourne { noteId, transcription } au client pour review humaine.
// ---------------------------------------------------------------------------

export async function uploadVoiceNoteAction(formData: FormData): Promise<
  | { noteId: string; transcription: string }
  | { error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { error: 'Non autorisé' }

  const parsed = uploadSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    duration_seconds: formData.get('duration_seconds'),
    mime_type: formData.get('mime_type'),
  })
  if (!parsed.success) return { error: 'Paramètres invalides' }

  const audioFile = formData.get('audio') as File | null
  if (!audioFile || audioFile.size === 0) return { error: 'Fichier audio manquant' }
  if (audioFile.size > 5 * 1024 * 1024) return { error: 'Fichier trop volumineux (max 5 Mo)' }

  const supabase = createAdminClient()
  const { intervention_id, duration_seconds, mime_type } = parsed.data

  // Résoudre site_id et tenant_id depuis l'intervention
  const { data: ctx } = await supabase
    .from('interventions')
    .select('missions!inner(sites!inner(id, tenant_id))')
    .eq('id', intervention_id)
    .maybeSingle()

  type Ctx = { missions: { sites: { id: string; tenant_id: string } } }
  const site = (ctx as Ctx | null)?.missions?.sites
  if (!site?.id || !site?.tenant_id) return { error: 'Site introuvable' }

  const noteId = crypto.randomUUID()
  const ext = mimeToExt(mime_type)
  const storagePath = `${site.tenant_id}/${site.id}/${intervention_id}/${noteId}.${ext}`

  // Upload artefact brut
  const rawBuffer = await audioFile.arrayBuffer() as ArrayBuffer
  const audioBytes = new Uint8Array(rawBuffer)
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, audioBytes, { contentType: mime_type, upsert: false })
  if (uploadErr) return { error: 'Échec de l\'enregistrement' }

  // Insérer la ligne (couche 1 persistée)
  const { error: insertErr } = await supabase.from('intervention_voice_notes').insert({
    id: noteId,
    intervention_id,
    site_id: site.id,
    tenant_id: site.tenant_id,
    storage_path: storagePath,
    mime_type,
    duration_seconds,
    recorded_by: auth.userId,
    status: 'pending_transcription',
    transcription_status: 'pending',
  })
  if (insertErr) return { error: 'Erreur base de données' }

  // Transcription — Google Gemini (priorité) ou Whisper (fallback), même logique que embeddings
  try {
    const text = await transcribeAudio(rawBuffer, mime_type, ext)

    await supabase
      .from('intervention_voice_notes')
      .update({ transcription_raw: text, transcription_status: 'done', status: 'transcribed' })
      .eq('id', noteId)

    return { noteId, transcription: text }
  } catch (e) {
    console.error(JSON.stringify({
      service: 'voice-note-actions',
      source: 'whisper',
      note_id: noteId,
      error: e instanceof Error ? e.message : String(e),
      ts: new Date().toISOString(),
    }))
    await supabase
      .from('intervention_voice_notes')
      .update({ transcription_status: 'failed', status: 'transcribed' })
      .eq('id', noteId)
    return { noteId, transcription: '' }
  }
}

// ---------------------------------------------------------------------------
// validateVoiceNoteAction — couche 3 : validation humaine + embedding
// Le fragment mémoire = texte corrigé par l'humain, jamais la sortie Whisper.
// ---------------------------------------------------------------------------

const validateSchema = z.object({
  note_id: z.string().uuid(),
  corrected_text: z.string().min(3).max(1000).trim(),
})

export async function validateVoiceNoteAction(formData: FormData): Promise<
  | { ok: true }
  | { error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { error: 'Non autorisé' }

  const parsed = validateSchema.safeParse({
    note_id: formData.get('note_id'),
    corrected_text: formData.get('corrected_text'),
  })
  if (!parsed.success) return { error: 'Texte invalide' }

  const supabase = createAdminClient()
  const { note_id, corrected_text } = parsed.data

  const { data: note, error: fetchErr } = await supabase
    .from('intervention_voice_notes')
    .select('id, site_id')
    .eq('id', note_id)
    .maybeSingle()
  if (fetchErr || !note) return { error: 'Note introuvable' }

  const { error: updateErr } = await supabase
    .from('intervention_voice_notes')
    .update({
      transcription_corrected: corrected_text,
      validated_at: new Date().toISOString(),
      validated_by: auth.userId,
      status: 'validated',
    })
    .eq('id', note_id)
  if (updateErr) return { error: 'Erreur base de données' }

  // Fire-and-forget : embedding du texte validé → Résonances / Persistances
  import('@/lib/ai/embed-trace').then(({ embedAndStoreTrace }) => {
    embedAndStoreTrace({
      sourceType: 'intervention_note',
      sourceId: note_id,
      siteId: (note as { site_id: string }).site_id,
      text: corrected_text,
    }).catch(() => { /* silencieux */ })
  }).catch(() => { /* silencieux */ })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// ignoreVoiceNoteAction — l'humain a refusé tous les éléments
// L'audio reste. La mémoire n'est pas alimentée.
// ---------------------------------------------------------------------------

export async function ignoreVoiceNoteAction(noteId: string): Promise<void> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return

  const supabase = createAdminClient()
  await supabase
    .from('intervention_voice_notes')
    .update({ status: 'ignored' })
    .eq('id', noteId)
}
