import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt, transcribeAudioForCopilot } from '@/lib/ai/transcribe'

export async function POST(req: NextRequest) {
  console.log('[Voice] request_received')

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let userId: string
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })
    userId = user.id
  } catch (err) {
    console.error('[Voice] auth_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Auth error', code: 'AUTH_ERROR' }, { status: 401 })
  }

  // ── 2. FormData ────────────────────────────────────────────────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[Voice] formdata_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'FormData parse failed', code: 'FORMDATA_ERROR' }, { status: 400 })
  }

  // ── 3. Extraction du fichier ───────────────────────────────────────────────
  const audioFile = form.get('audio') as File | null
  const siteId    = form.get('siteId') as string | null

  if (!audioFile) {
    console.error('[Voice] audio_missing — champ "audio" absent du FormData')
    return NextResponse.json({ error: 'Audio manquant', code: 'AUDIO_MISSING' }, { status: 400 })
  }

  // ── 4. Lecture du buffer ───────────────────────────────────────────────────
  let rawBuffer: ArrayBuffer
  try {
    rawBuffer = await audioFile.arrayBuffer()
  } catch (err) {
    console.error('[Voice] buffer_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Lecture buffer échouée', code: 'BUFFER_ERROR' }, { status: 400 })
  }

  if (rawBuffer.byteLength === 0) {
    console.error('[Voice] audio_empty — blob reçu avec size=0')
    return NextResponse.json({ error: 'Audio vide', code: 'AUDIO_EMPTY' }, { status: 400 })
  }

  const mimeType = audioFile.type || 'audio/webm'
  const ext      = mimeToExt(mimeType)
  console.log('[Voice] audio_received', { size: rawBuffer.byteLength, type: mimeType, name: audioFile.name, ext, userId })

  // ── 5. Prompt lexical ──────────────────────────────────────────────────────
  const lexicalPrompt = siteId ? await buildLexicalPrompt(siteId) : undefined
  console.log('[Voice] lexical_prompt_ready', { length: lexicalPrompt?.length ?? 0 })

  // ── 6. Transcription ───────────────────────────────────────────────────────
  console.log('[Voice] provider_call_start', { model: 'gpt-4o-mini-transcribe', mimeType, ext })

  let result: Awaited<ReturnType<typeof transcribeAudioForCopilot>>
  try {
    result = await transcribeAudioForCopilot(rawBuffer, mimeType, ext, lexicalPrompt || undefined)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur provider'
    console.error('[Voice] provider_error:', msg)
    if (msg.includes('OPENAI_API_KEY')) {
      return NextResponse.json({ error: msg, code: 'OPENAI_AUTH_ERROR' }, { status: 500 })
    }
    return NextResponse.json({ error: msg, code: 'TRANSCRIBE_PROVIDER_ERROR' }, { status: 500 })
  }

  if (!result.text) {
    console.warn('[Voice] transcription_empty — provider returned no text')
    return NextResponse.json({ text: '', code: 'TRANSCRIBE_EMPTY' })
  }

  console.log('[Voice] provider_call_ok', { chars: result.text.length, model: result.model })

  return NextResponse.json({
    text:         result.text,
    model:        result.model,
    tokensAudio:  result.tokensAudio  ?? null,
    tokensOutput: result.tokensOutput ?? null,
  })
}

async function buildLexicalPrompt(siteId: string): Promise<string> {
  try {
    const admin = createAdminClient()
    const [siteRes, subjectsRes] = await Promise.all([
      admin.from('sites').select('name').eq('id', siteId).single(),
      admin
        .from('canonical_subject')
        .select('label')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    const parts: string[] = []
    if (siteRes.data?.name) parts.push(siteRes.data.name)
    if (subjectsRes.data?.length) parts.push(subjectsRes.data.map((s) => s.label).join(', '))
    return parts.join('. ')
  } catch {
    return ''
  }
}
