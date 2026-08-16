import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { resolveResourceAccess } from '@/lib/auth/resource-access'
import { buildSiteVocabulary } from '@/lib/ai/stt-vocabulary'

// P3-B — ouverture d'un tour de transcription Gemini Live depuis le téléphone.
//
// Promue du banc `/api/spike/live-token` après la campagne du 16/08 : Live rend
// le transcript ~4,6 s plus tôt que le STT serveur (p50 1 165 ms contre
// 5 776 ms depuis la fin de parole, 17 essais sur téléphone réel).
//
// Pourquoi cette route existe : le téléphone doit ouvrir un WebSocket DIRECT
// vers Gemini (Vercel n'héberge pas de serveur WebSocket, et le mandat interdit
// un relais). La clé Gemini permanente ne descend donc jamais dans la PWA ; le
// jeton éphémère est le seul mécanisme officiel pour ça.
//
// Ce que le jeton garantit :
//   - `uses: 1`              → un seul WebSocket, pas de réutilisation
//   - `newSessionExpireTime` → 60 s pour ouvrir la connexion, ensuite mort
//   - `expireTime`           → la session ouverte meurt au bout de 5 min
//   - `bidiGenerateContentSetup` → setup COMPLET gelé côté serveur (modèle,
//     modalité, transcription d'entrée, instruction) : un jeton fuité ne peut
//     ni changer de modèle, ni transformer la session en générateur libre.
//
// FORME FILAIRE — vérifiée contre l'API réelle, pas contre la documentation
// (`scripts/_probe-live-token.ts` et `_probe-live-token-setup.ts`, 16/08) :
//   - l'endpoint est en **v1alpha** ; `v1beta` accepte `auth_tokens` mais
//     rejette la contrainte ;
//   - le champ ne s'appelle PAS `liveConnectConstraints` (nom SDK) mais
//     `bidiGenerateContentSetup`, **à plat** ;
//   - **le setup du jeton REMPLACE celui du client, il ne s'y ajoute pas** —
//     d'où une config COMPLÈTE ici, seule forme qui fonctionne ;
//   - `responseModalities: ['AUDIO']` est OBLIGATOIRE : les 6 modèles Live
//     visibles par cette clé refusent TEXT (close 1007).
//
// PAS DE LEXIQUE dans l'instruction, contrairement au banc : `systemInstruction`
// ne biaise pas `inputAudioTranscription` — RÉFUTÉ 6 fois sur 6
// (`scripts/_probe-live-lexique.ts`). Le canal de transcription est distinct de
// la réponse du modèle. La correction des noms propres du chantier se fait donc
// APRÈS, côté client, contre le vocabulaire fermé renvoyé ci-dessous.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LIVE_MODEL = 'gemini-3.1-flash-live-preview'

/** Délai laissé au téléphone pour ouvrir le WebSocket après la frappe du jeton. */
const OPEN_WINDOW_MS = 60_000
/** Durée de vie maximale de la session une fois ouverte : un tour de parole. */
const SESSION_TTL_MS = 5 * 60_000

/**
 * Le modèle DOIT répondre (la modalité AUDIO est imposée par l'API), mais sa
 * réponse n'est jamais écoutée : seul le canal `inputTranscription` nous
 * intéresse. On lui demande donc le silence le plus court possible — chaque
 * jeton généré est du temps et de l'argent dépensés pour rien.
 */
const LIVE_INSTRUCTION =
  'Tu assistes un conducteur de travaux sur un chantier en Nouvelle-Calédonie. ' +
  'Réponds toujours par un seul mot : « ok ». Ne commente rien.'

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_GENAI_API_KEY absente', code: 'NO_KEY' }, { status: 500 })
  }

  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  let siteId: string | null = null
  try {
    const body = (await req.json()) as { siteId?: string }
    siteId = body.siteId ?? null
  } catch {
    // Corps illisible — traité comme un siteId absent.
  }
  if (!UUID_RE.test(siteId ?? '')) {
    return NextResponse.json({ error: 'siteId invalide', code: 'SITE_ID_INVALID' }, { status: 400 })
  }

  // Accès AVANT toute lecture métier : `buildSiteVocabulary` passe par le client
  // admin, qui bypasse la RLS. Même primitive et même 404 uniforme que
  // `/api/copilot/free-stream` — chantier étranger et chantier inexistant sont
  // indiscernables, aucun oracle.
  const access = await resolveResourceAccess({ kind: 'site', id: siteId as string }, user)
  if (!access.ok) {
    return NextResponse.json({ error: 'Introuvable', code: 'NOT_FOUND' }, { status: 404 })
  }

  // Vocabulaire et jeton en parallèle : le jeton est un aller-retour réseau vers
  // Google, le vocabulaire quelques lectures Supabase. Les enchaîner ajouterait
  // leur somme au délai d'ouverture du micro.
  const vocabularyPromise = buildSiteVocabulary(access.context.resourceId)

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
        systemInstruction: { parts: [{ text: LIVE_INSTRUCTION }] },
      },
    }),
  }).catch((err: unknown) => {
    console.error('[live-token] fetch_error:', err instanceof Error ? err.message : err)
    return null
  })

  if (!res || !res.ok) {
    const detail = res ? (await res.text()).slice(0, 300) : 'network'
    console.error('[live-token] token_error', res?.status ?? 0, detail)
    return NextResponse.json({ error: 'Jeton indisponible', code: 'TOKEN_ERROR' }, { status: 502 })
  }

  const data = (await res.json()) as { name?: string }
  if (!data.name) {
    return NextResponse.json({ error: 'Jeton sans champ name', code: 'TOKEN_SHAPE' }, { status: 502 })
  }

  // Le vocabulaire descend AVEC le jeton, pour la normalisation côté client.
  // C'est le seul « paquet » du tour : quelques termes déjà visibles dans la
  // fiche intervenants, aucune décision d'autorisation, rien de réutilisable.
  // Il ne contient AUCUNE donnée métier de réponse — voir le commentaire de
  // `lib/voice/live-stt.ts` sur l'abandon du recouvrement MIC_READY.
  return NextResponse.json({
    token: data.name,
    model: LIVE_MODEL,
    vocabulary: await vocabularyPromise,
  })
}
