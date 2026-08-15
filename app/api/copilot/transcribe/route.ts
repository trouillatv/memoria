import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOwned } from '@/lib/auth/ownership'
import { mimeToExt, transcribeAudioForCopilot } from '@/lib/ai/transcribe'

/** Rien ne part vers la base sans un UUID valide — avant même le contrôle d'accès. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  console.log('[Voice] request_received')

  // Chronométrage des étapes serveur (mandat Vincent, 15/08 : instrumenter AVANT
  // d'optimiser ; 16/08 : décomposer les ~4 s résiduelles du STT).
  //   formMs        — réception du corps de requête vue du serveur
  //   authMs        — session Supabase + profil
  //   authzMs       — appartenance de l'appelant à l'organisation DU CHANTIER
  //   bufferMs      — matérialisation de l'audio
  //   lexiconMs     — durée PROPRE du lexique PETRO/SSI
  //   lexiconWaitMs — ce qu'il en reste réellement à payer une fois le buffer lu
  //   sttMs         — transcription, décomposée par le fournisseur (openaiMs,
  //                   encodeMs, providerWaitMs, providerBodyMs, payloadBytes)
  // Le lexique n'est ni supprimé ni réduit : Vincent refuse de sacrifier la
  // transcription contextualisée.
  const t0 = Date.now()
  const marks: Record<string, number> = {}
  const mark = (key: string, from: number) => { marks[key] = Date.now() - from }

  // ── 1. FormData ────────────────────────────────────────────────────────────
  // Elle porte le `siteId` et l'audio. Sa lecture ne touche aucune donnée
  // métier : c'est le corps de la requête de l'appelant, il n'y a rien à
  // autoriser pour le lire.
  let form: FormData
  const tForm = Date.now()
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[Voice] formdata_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'FormData parse failed', code: 'FORMDATA_ERROR' }, { status: 400 })
  }

  mark('formMs', tForm)

  const audioFile = form.get('audio') as File | null
  const siteId    = form.get('siteId') as string | null

  // ── 2. Auth ────────────────────────────────────────────────────────────────
  // `getCurrentUserWithProfile` plutôt qu'un `auth.getUser()` nu : il rend le
  // rôle exigé par la signature de `requireOwned`. Il est enveloppé dans React
  // `cache()`, donc la garde le relira sans seconde lecture SI la mémoïsation
  // par requête s'applique dans un route handler. Si elle ne s'applique pas, le
  // surcoût est d'exactement une lecture `users` — visible dans `authzMs`, qui
  // vaudra alors trois allers-retours au lieu de deux.
  let user: NonNullable<Awaited<ReturnType<typeof getCurrentUserWithProfile>>>
  const tAuth = Date.now()
  try {
    const current = await getCurrentUserWithProfile()
    if (!current) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })
    user = current
  } catch (err) {
    console.error('[Voice] auth_error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Auth error', code: 'AUTH_ERROR' }, { status: 401 })
  }
  const userId = user.id

  mark('authMs', tAuth)

  if (!audioFile) {
    console.error('[Voice] audio_missing — champ "audio" absent du FormData')
    return NextResponse.json({ error: 'Audio manquant', code: 'AUDIO_MISSING' }, { status: 400 })
  }

  // ── 3. Autorisation du chantier ────────────────────────────────────────────
  // `buildLexicalPrompt` lit `sites.name` et 20 `canonical_subject.label` via le
  // client admin, qui BYPASSE la RLS. Sans cette garde, n'importe quel appelant
  // connaissant un UUID obtenait le nom d'un chantier étranger et 15 de ses
  // sujets, injectés dans SON propre prompt de transcription. C'est exactement
  // l'incident d'isolation documenté dans `lib/field/site-access.ts`, sur un
  // chemin qui y avait échappé parce qu'il n'est pas une page.
  //
  // La garde est donc SÉRIELLE et non recouverte : aucune lecture métier avant
  // autorisation, même jetée ensuite. Le coût est mesuré (`authzMs`).
  const tAuthz = Date.now()
  let lexiconSiteId: string | null = null
  if (UUID_RE.test(siteId ?? '')) {
    const owned = await requireOwned(user.role, 'sites', siteId as string)
    if (owned.allowed) {
      lexiconSiteId = siteId as string
    } else {
      // Pas de 404 : on dégrade au lieu de refuser. Un chantier étranger, un
      // chantier inexistant et un chantier orphelin donnent tous exactement le
      // même comportement observable — une transcription sans lexique, celle
      // qu'obtient déjà tout appel sans `siteId`. Aucun oracle d'existence, et
      // aucune régression possible sur un chantier mal rattaché.
      console.warn('[Voice] lexicon_denied — chantier hors périmètre de l’appelant', { userId })
    }
  }
  mark('authzMs', tAuthz)

  // ── 4. Prompt lexical — lancé, pas attendu ─────────────────────────────────
  // Lancé APRÈS l'autorisation, donc plus rien à recouvrir en amont : il ne
  // reste que la lecture du buffer (0–3 ms mesurés). `lexiconMs` = durée propre,
  // `lexiconWaitMs` = résidu réellement payé ; l'écart entre les deux dit
  // combien il reste de parallélisme — aujourd'hui presque zéro, et c'est le
  // prix assumé de la garde.
  const tLex = Date.now()
  const lexicalPromise: Promise<string> = lexiconSiteId
    ? buildLexicalPrompt(lexiconSiteId)
        .then((v) => { marks.lexiconMs = Date.now() - tLex; return v })
        // Aucune sortie anticipée ne doit laisser derrière elle une promesse
        // rejetée non gérée.
        .catch(() => '')
    : Promise.resolve('')

  // ── 5. Lecture du buffer ───────────────────────────────────────────────────
  const tBuffer = Date.now()
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

  mark('bufferMs', tBuffer)

  const mimeType = audioFile.type || 'audio/webm'
  const ext      = mimeToExt(mimeType)
  console.log('[Voice] audio_received', { size: rawBuffer.byteLength, type: mimeType, name: audioFile.name, ext, userId })

  // ── 6. Prompt lexical — attente résiduelle ─────────────────────────────────
  const tLexWait = Date.now()
  const lexicalPrompt = await lexicalPromise
  mark('lexiconWaitMs', tLexWait)
  console.log('[Voice] lexical_prompt_ready', {
    length: lexicalPrompt.length, ownMs: marks.lexiconMs ?? 0, waitMs: marks.lexiconWaitMs,
  })

  // ── 7. Transcription ───────────────────────────────────────────────────────
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
  // `sttMs` agrégeait quatre choses distinctes ; il porte désormais sa
  // décomposition, seul moyen d'expliquer les ~4 s résiduelles au prochain
  // benchmark. `openaiMs` absent = le disjoncteur a évité l'aller-retour.
  console.log('[Voice] timing', JSON.stringify({
    bytes: rawBuffer.byteLength, ...marks, ...(result.timings ?? {}), totalMs: Date.now() - t0,
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
