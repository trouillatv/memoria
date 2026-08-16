import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOwned } from '@/lib/auth/ownership'
import { buildLexicalPrompt } from '@/lib/ai/stt-lexicon'

// P3-A — SPIKE. Frappe un jeton éphémère Gemini Live pour le banc `/m/spike-voice`.
// À supprimer avec le banc si Gemini Live n'entre pas dans l'architecture.
//
// Pourquoi cette route existe : le téléphone doit ouvrir un WebSocket DIRECT vers
// Gemini (Vercel n'héberge pas de serveur WebSocket, et le mandat interdit un
// relais). La clé Gemini permanente ne doit donc jamais descendre dans la PWA.
// Le jeton éphémère est le seul mécanisme officiel pour ça.
//
// Ce que le jeton garantit :
//   - `uses: 1`              → un seul WebSocket, pas de réutilisation
//   - `newSessionExpireTime` → 60 s pour ouvrir la connexion, ensuite mort
//   - `expireTime`           → la session ouverte meurt au bout de 10 min
//   - `liveConnectConstraints.model` → verrouillé, un jeton fuité ne peut pas
//     être repointé vers un autre modèle
//
// Ce qu'il NE garantit pas encore : le verrouillage de la `config` complète.
// La contrainte impose que la config du client corresponde à celle scellée
// côté serveur, et l'égalité exacte après transformation par le SDK n'est pas
// vérifiée ici — un désaccord se traduirait par un refus de connexion sur le
// téléphone de Vincent, c'est-à-dire une manche perdue pour rien. On verrouille
// donc le modèle seul, et on documente l'écart plutôt que de le taire. Fenêtre
// de 60 s, usage unique, jeton qui ne quitte pas le navigateur déjà
// authentifié : le reste est du durcissement à faire si Live est retenu.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LIVE_MODEL = 'gemini-3.1-flash-live-preview'

/** Délai laissé au téléphone pour ouvrir le WebSocket après la frappe du jeton. */
const OPEN_WINDOW_MS = 60_000
/** Durée de vie maximale de la session une fois ouverte. */
const SESSION_TTL_MS = 10 * 60_000

/**
 * Instruction système de la session Live.
 *
 * Elle reprend MOT POUR MOT la formulation du lexique de `transcribe.ts`, pour
 * que la comparaison Live / batch porte sur le moteur et non sur deux
 * rédactions différentes.
 *
 * ATTENTION — hypothèse non vérifiée : en batch, le lexique agit sur la
 * transcription parce que la transcription EST la sortie du modèle. En Live, la
 * transcription vient de `inputAudioTranscription`, un canal distinct de la
 * réponse du modèle. Rien ne garantit que `systemInstruction` biaise ce
 * canal-là. C'est précisément ce que le spike mesure : si « PETRO ATITI »
 * ressort faux 3/3 malgré ce lexique, la conclusion est que Live n'offre pas
 * de canal lexical — pas que le lexique a été mal écrit.
 */
function buildLiveInstruction(lexicalPrompt: string): string {
  const base =
    'Tu assistes un conducteur de travaux sur un chantier en Nouvelle-Calédonie. ' +
    'Réponds toujours par un seul mot : « ok ». Ne commente rien.'
  if (!lexicalPrompt) return base
  return (
    base +
    '\nCes termes peuvent apparaître dans ce qui est dit et servent uniquement d\'aide ' +
    'à la reconnaissance : ' +
    lexicalPrompt +
    '.\nNe les ajoute jamais s\'ils ne sont pas prononcés.'
  )
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_GENAI_API_KEY absente', code: 'NO_KEY' }, { status: 500 })
  }

  // ── 1. Authentification ────────────────────────────────────────────────────
  let user: NonNullable<Awaited<ReturnType<typeof getCurrentUserWithProfile>>>
  try {
    const current = await getCurrentUserWithProfile()
    if (!current) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })
    user = current
  } catch {
    return NextResponse.json({ error: 'Auth error', code: 'AUTH_ERROR' }, { status: 401 })
  }

  let siteId: string | null = null
  try {
    const body = (await req.json()) as { siteId?: string }
    siteId = body.siteId ?? null
  } catch {
    // Corps absent ou illisible : on continue sans lexique.
  }

  // ── 2. Autorisation du chantier AVANT le lexique ───────────────────────────
  // `buildLexicalPrompt` passe par le client admin, qui bypasse la RLS. Même
  // garde et même dégradation silencieuse que `/api/copilot/transcribe` : un
  // chantier étranger donne une session sans lexique, jamais un 404 qui
  // révélerait son existence.
  let lexiconSiteId: string | null = null
  if (UUID_RE.test(siteId ?? '')) {
    const owned = await requireOwned(user.role, 'sites', siteId as string, user)
    if (owned.allowed) lexiconSiteId = siteId as string
    else console.warn('[SpikeLive] lexicon_denied', { userId: user.id })
  }

  const lexicalPrompt = lexiconSiteId ? await buildLexicalPrompt(lexiconSiteId) : ''

  // ── 3. Frappe du jeton éphémère ────────────────────────────────────────────
  const now = Date.now()
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + SESSION_TTL_MS).toISOString(),
      newSessionExpireTime: new Date(now + OPEN_WINDOW_MS).toISOString(),
      liveConnectConstraints: { model: LIVE_MODEL },
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('[SpikeLive] token_error', res.status, detail.slice(0, 500))
    return NextResponse.json(
      { error: `Gemini ${res.status}`, detail: detail.slice(0, 500), code: 'TOKEN_ERROR' },
      { status: 502 },
    )
  }

  const data = (await res.json()) as { name?: string }
  if (!data.name) {
    return NextResponse.json({ error: 'Jeton sans champ name', code: 'TOKEN_SHAPE' }, { status: 502 })
  }

  return NextResponse.json({
    token: data.name,
    model: LIVE_MODEL,
    instruction: buildLiveInstruction(lexicalPrompt),
    lexiconTerms: lexicalPrompt ? lexicalPrompt.split(',').length : 0,
  })
}
