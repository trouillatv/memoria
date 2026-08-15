import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt, transcribeAudioForCopilot } from '@/lib/ai/transcribe'

export async function POST(req: NextRequest) {
  console.log('[Voice] request_received')

  // Chronométrage des quatre étapes serveur (mandat Vincent, 15/08 : instrumenter
  // AVANT d'optimiser). `formMs` n'est pas du calcul : c'est le temps pendant
  // lequel le serveur reçoit l'audio, donc la part réseau de l'upload vue du
  // serveur — la seule mesurable ici. `lexiconMs` est le prix de la
  // transcription contextualisée PETRO/SSI : Vincent refuse de la sacrifier,
  // mais on veut savoir ce qu'elle coûte réellement.
  const t0 = Date.now()
  const marks: Record<string, number> = {}
  const mark = (key: string, from: number) => { marks[key] = Date.now() - from }

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let userId: string
  const tAuth = Date.now()
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })
    userId = user.id
  } catch (err) {
    console.error('[Voice] auth_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Auth error', code: 'AUTH_ERROR' }, { status: 401 })
  }

  mark('authMs', tAuth)

  // ── 2. FormData ────────────────────────────────────────────────────────────
  let form: FormData
  const tForm = Date.now()
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[Voice] formdata_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'FormData parse failed', code: 'FORMDATA_ERROR' }, { status: 400 })
  }

  mark('formMs', tForm)

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
  const tLex = Date.now()
  const lexicalPrompt = siteId ? await buildLexicalPrompt(siteId) : undefined
  mark('lexiconMs', tLex)
  console.log('[Voice] lexical_prompt_ready', { length: lexicalPrompt?.length ?? 0, ms: marks.lexiconMs })

  // ── 6. Transcription ───────────────────────────────────────────────────────
  console.log('[Voice] provider_call_start', { model: 'gpt-4o-mini-transcribe', mimeType, ext })

  let result: Awaited<ReturnType<typeof transcribeAudioForCopilot>>
  const tStt = Date.now()
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

  // Détection de fuite lexique : si ≥ 3 termes du lexique apparaissent dans la
  // transcription, c'est probablement une contamination prompt→sortie.
  if (lexicalPrompt) {
    const terms = lexicalPrompt.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 4)
    const outputLower = result.text.toLowerCase()
    const leaked = terms.filter((t) => outputLower.includes(t))
    if (leaked.length >= 3) {
      console.error('[Voice] STT_LEXICON_LEAK', { leakedCount: leaked.length, textLen: result.text.length, model: result.model })
    }
  }

  mark('sttMs', tStt)
  console.log('[Voice] provider_call_ok', { chars: result.text.length, model: result.model })
  console.log('[Voice] timing', JSON.stringify({
    bytes: rawBuffer.byteLength, ...marks, totalMs: Date.now() - t0,
  }))

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
    const terms: string[] = []
    if (siteRes.data?.name) terms.push(siteRes.data.name)
    if (subjectsRes.data?.length) {
      const STOP_WORDS = /^(le|la|les|un|une|des|de|du|au|aux|en|à|et|ou|sur|pour|par|dans|avec|sans)\b/i
      const shortLabels = subjectsRes.data
        .map((s) => s.label.trim())
        .filter((l) =>
          l.length > 0 &&
          l.length <= 40 &&         // pas de descriptions longues
          l.split(/\s+/).length <= 4 && // max 4 mots (codes, noms, sigles)
          !STOP_WORDS.test(l) &&    // pas de phrases débutant par un article
          !/\d{1,2}\/\d{2}/.test(l), // pas de dates (ex: "30/03")
        )
      terms.push(...shortLabels.slice(0, 15))
    }
    // Format : liste de termes séparés par des virgules — pas de phrases complètes.
    return terms.join(', ')
  } catch {
    return ''
  }
}
