'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldAgent } from '@/lib/field/auth'

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
  // Hardcodé : gemini-2.0-flash n'est plus dispo, on ne laisse pas l'env var l'écraser
  const model = 'gemini-2.5-flash'
  const base64 = Buffer.from(rawBuffer).toString('base64')
  // Gemini n'accepte pas le suffixe codec (ex: "audio/webm;codecs=opus" → "audio/webm")
  const safeMime = mimeType.split(';')[0].trim()

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: safeMime, data: base64 } },
            { text: 'Transcris cet audio en français. Retourne uniquement la transcription brute, sans explication ni ponctuation ajoutée.' },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
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
// Extraction IA structurée — Gemini uniquement (JSON mode)
// ---------------------------------------------------------------------------

export interface ExtractionProposed {
  lieux: string[]
  problemes: string[]
  equipements: string[]
  statut: 'revient' | 'résolu' | 'à vérifier' | 'absent' | 'pas réapparu' | null
  fragment: string
}

async function extractElementsWithGemini(correctedText: string): Promise<ExtractionProposed> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY!
  const model = 'gemini-2.5-flash'

  const prompt = `Tu analyses une note audio terrain d'un agent de nettoyage ou de maintenance.

Transcription :
"""
${correctedText}
"""

Extrais de cette transcription :
- lieux : zones, salles, blocs, secteurs nommés (ex : "bloc B", "couloir nord", "pédiatrie")
- problemes : anomalies, observations négatives, problèmes (ex : "humidité", "fuite", "mauvaise odeur")
- equipements : équipements ou installations mentionnés (ex : "lavabo", "sol", "ascenseur")
- statut : UN SEUL parmi ["revient", "résolu", "à vérifier", "absent", "pas réapparu"], null si aucun n'est clair
- fragment : phrase mémoire télégraphique 5-10 mots (ex : "bloc B revient — humidité", "fuite salle C résolue")

Retourne uniquement du JSON valide :
{"lieux":[],"problemes":[],"equipements":[],"statut":null,"fragment":""}`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini extract ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Gemini extraction: JSON invalide')
  }

  const VALID_STATUTS = ['revient', 'résolu', 'à vérifier', 'absent', 'pas réapparu'] as const
  type ValidStatut = typeof VALID_STATUTS[number]

  return {
    lieux: Array.isArray(parsed.lieux) ? (parsed.lieux as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    problemes: Array.isArray(parsed.problemes) ? (parsed.problemes as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    equipements: Array.isArray(parsed.equipements) ? (parsed.equipements as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    statut: VALID_STATUTS.includes(parsed.statut as ValidStatut) ? (parsed.statut as ValidStatut) : null,
    fragment: typeof parsed.fragment === 'string' ? parsed.fragment.trim().slice(0, 200) : '',
  }
}

// ---------------------------------------------------------------------------
// uploadVoiceNoteAction — upload + transcription en une passe
// Retourne { noteId, transcription } au client pour review humaine.
// ---------------------------------------------------------------------------

export async function uploadVoiceNoteAction(formData: FormData): Promise<
  | { noteId: string; transcription: string; transcriptionError?: string }
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

  const rawBuffer = await audioFile.arrayBuffer() as ArrayBuffer
  const audioBytes = new Uint8Array(rawBuffer)
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, audioBytes, { contentType: mime_type, upsert: false })
  if (uploadErr) return { error: 'Échec de l\'enregistrement' }

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

  try {
    const text = await transcribeAudio(rawBuffer, mime_type, ext)
    await supabase
      .from('intervention_voice_notes')
      .update({ transcription_raw: text, transcription_status: 'done', status: 'transcribed' })
      .eq('id', noteId)
    return { noteId, transcription: text }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    console.error(JSON.stringify({
      service: 'voice-note-actions',
      source: 'transcription',
      note_id: noteId,
      error: errMsg,
      ts: new Date().toISOString(),
    }))
    await supabase
      .from('intervention_voice_notes')
      .update({ transcription_status: 'failed', status: 'transcribed' })
      .eq('id', noteId)
    return { noteId, transcription: '', transcriptionError: errMsg }
  }
}

// ---------------------------------------------------------------------------
// extractVoiceNoteAction — couche 2 : extraction IA structurée
// Prend la transcription corrigée par l'humain, lance Gemini, propose des
// éléments mémoire. L'humain n'a encore rien validé à ce stade.
// ---------------------------------------------------------------------------

const extractSchema = z.object({
  note_id: z.string().uuid(),
  corrected_text: z.string().min(3).max(1000).trim(),
})

export async function extractVoiceNoteAction(formData: FormData): Promise<
  | { extraction: ExtractionProposed; fragment: string }
  | { error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { error: 'Non autorisé' }

  const parsed = extractSchema.safeParse({
    note_id: formData.get('note_id'),
    corrected_text: formData.get('corrected_text'),
  })
  if (!parsed.success) return { error: 'Paramètres invalides' }

  const supabase = createAdminClient()
  const { note_id, corrected_text } = parsed.data

  // Sauvegarder la transcription corrigée
  await supabase
    .from('intervention_voice_notes')
    .update({ transcription_corrected: corrected_text })
    .eq('id', note_id)

  // Extraction IA — Gemini uniquement (pas de Whisper fallback pour du texte)
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    // Pas de clé : retourner extraction vide, le fragment sera saisi manuellement
    return {
      extraction: { lieux: [], problemes: [], equipements: [], statut: null, fragment: '' },
      fragment: '',
    }
  }

  try {
    const extraction = await extractElementsWithGemini(corrected_text)

    await supabase
      .from('intervention_voice_notes')
      .update({
        extraction_proposed: extraction,
        fragment_proposed: extraction.fragment,
        status: 'extraction_done',
      })
      .eq('id', note_id)

    return { extraction, fragment: extraction.fragment }
  } catch (e) {
    console.error(JSON.stringify({
      service: 'voice-note-actions',
      source: 'extraction',
      note_id,
      error: e instanceof Error ? e.message : String(e),
      ts: new Date().toISOString(),
    }))
    // Fallback silencieux : l'humain saisira le fragment manuellement
    return {
      extraction: { lieux: [], problemes: [], equipements: [], statut: null, fragment: '' },
      fragment: '',
    }
  }
}

// ---------------------------------------------------------------------------
// validateFragmentAction — couche 3 : validation humaine + embedding
// L'humain a sélectionné les éléments et validé (ou édité) le fragment.
// C'est fragment_validated — et uniquement lui — qui entre dans les embeddings.
// ---------------------------------------------------------------------------

const validateFragmentSchema = z.object({
  note_id: z.string().uuid(),
  elements: z.string(), // JSON stringifié de l'extraction validée
  fragment: z.string().min(1).max(200).trim(),
})

export async function validateFragmentAction(formData: FormData): Promise<
  | { ok: true }
  | { error: string }
> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { error: 'Non autorisé' }

  const parsed = validateFragmentSchema.safeParse({
    note_id: formData.get('note_id'),
    elements: formData.get('elements'),
    fragment: formData.get('fragment'),
  })
  if (!parsed.success) return { error: 'Paramètres invalides' }

  let extractionValidated: unknown = null
  try {
    extractionValidated = JSON.parse(parsed.data.elements)
  } catch {
    extractionValidated = null
  }

  const supabase = createAdminClient()
  const { note_id, fragment } = parsed.data

  const { data: note, error: fetchErr } = await supabase
    .from('intervention_voice_notes')
    .select('id, site_id')
    .eq('id', note_id)
    .maybeSingle()
  if (fetchErr || !note) return { error: 'Note introuvable' }

  const { error: updateErr } = await supabase
    .from('intervention_voice_notes')
    .update({
      extraction_validated: extractionValidated,
      fragment_validated: fragment,
      validated_at: new Date().toISOString(),
      validated_by: auth.userId,
      status: 'validated',
    })
    .eq('id', note_id)
  if (updateErr) return { error: 'Erreur base de données' }

  // Fire-and-forget : embedding du fragment validé → Résonances / Persistances
  // On embedde le fragment, pas la transcription brute.
  import('@/lib/ai/embed-trace').then(({ embedAndStoreTrace }) => {
    embedAndStoreTrace({
      sourceType: 'intervention_note',
      sourceId: note_id,
      siteId: (note as { site_id: string }).site_id,
      text: fragment,
    }).catch(() => { /* silencieux */ })
  }).catch(() => { /* silencieux */ })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// ignoreVoiceNoteAction — l'humain a refusé
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
