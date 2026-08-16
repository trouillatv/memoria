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
//   - `bidiGenerateContentSetup` → setup COMPLET gelé côté serveur (modèle,
//     modalité, transcription d'entrée, instruction) : un jeton fuité ne peut
//     ni changer de modèle, ni transformer la session en générateur libre.
//
// FORME FILAIRE — vérifiée contre l'API réelle, pas contre la documentation
// (`scripts/_probe-live-token.ts` et `_probe-live-token-setup.ts`, 16/08) :
//   - l'endpoint est en **v1alpha** ; `v1beta` accepte bien `auth_tokens` mais
//     rejette la contrainte ;
//   - le champ ne s'appelle PAS `liveConnectConstraints` (nom SDK) mais
//     `bidiGenerateContentSetup`, **à plat**. La traduction du SDK 2.3.0
//     (`liveConnectConstraintsToMldev`) produit un niveau `setup`
//     supplémentaire que l'API refuse aujourd'hui.
//   - **le setup du jeton REMPLACE celui du client, il ne s'y ajoute pas.**
//     Preuve : contrainte « modèle seul » → session ouverte, audio reçu, modèle
//     qui répond, et transcription VIDE ; en ajoutant `inputAudioTranscription`
//     à la contrainte, la transcription revient. Même mécanisme derrière la
//     fermeture 1011 observée d'abord : sans `responseModalities` dans la
//     contrainte, la modalité retombait sur TEXT, que le modèle refuse.
//     C'est pourquoi la config est ici COMPLÈTE — ce n'est pas un
//     contournement, c'est la seule forme qui marche, et elle ferme au passage
//     l'écart de sécurité que cette route documentait comme non couvert.
//   - `responseModalities: ['AUDIO']` est OBLIGATOIRE : les 6 modèles Live
//     visibles par cette clé refusent TEXT (close 1007, message explicite). La
//     réponse audio du modèle n'est pas exploitée par le banc ; seul le canal
//     `inputTranscription` est mesuré.
//
// Une limite assumée et non masquée : la réponse ne contient que `name`, les
// durées de vie sont acceptées sans être renvoyées — leur effet n'est pas
// vérifié ici.

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
 * HYPOTHÈSE TRANCHÉE — elle était notée ici comme non vérifiée ; elle est
 * maintenant RÉFUTÉE côté moteur (`scripts/_probe-live-lexique.ts`, 6 phrases
 * du corpus, voix de synthèse fr-FR) : la transcription est **strictement
 * identique** avec et sans lexique, 6 fois sur 6. `systemInstruction` ne biaise
 * pas `inputAudioTranscription` — c'est bien un canal distinct de la réponse du
 * modèle. On conserve malgré tout le lexique dans le setup gelé pour que la
 * mesure téléphone se fasse dans des conditions identiques à la production.
 * Si un terme métier ressort faux sur le téléphone, la conclusion est « Live
 * n'offre pas de canal lexical », pas « le lexique est mal écrit ».
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
  const instruction = buildLiveInstruction(lexicalPrompt)
  const now = Date.now()
  const res = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + SESSION_TTL_MS).toISOString(),
      newSessionExpireTime: new Date(now + OPEN_WINDOW_MS).toISOString(),
      // Setup COMPLET : ce que le client enverra sera ignoré au profit de ceci.
      bidiGenerateContentSetup: {
        model: `models/${LIVE_MODEL}`,
        inputAudioTranscription: {},
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: instruction }] },
      },
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

  // `instruction` n'est PAS renvoyée : elle est gelée dans le jeton, et la
  // renvoyer laisserait croire au client qu'il a quelque chose à en faire.
  return NextResponse.json({
    token: data.name,
    model: LIVE_MODEL,
    lexiconTerms: lexicalPrompt ? lexicalPrompt.split(',').length : 0,
  })
}
