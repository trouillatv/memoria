// Nettoyage éditorial borné d'une légende photo dictée — lot post-shutter rework
// (mandat Vincent, recette terrain 2026-08-24) : le transcript STT brut n'est pas
// assez éditorial pour devenir directement une légende ("euh la fissure elle est
// toujours là quoi"). Cette fonction ne fait QUE nettoyer la forme, jamais le fond.
//
// Contrat non négociable : suppression des hésitations/répétitions/amorces sans
// contenu + ponctuation + syntaxe naturelle — jamais un fait ajouté, une négation
// supprimée/inversée, une incertitude ("peut-être", "environ") devenue certaine, un
// nom propre/nombre/unité/date modifié, ou une interprétation de la photo. En cas de
// doute le modèle doit conserver le mot plutôt que le retirer.
//
// Ne lève jamais — toute panne retourne un diagnostic typé ; l'appelant doit alors
// se rabattre sur le transcript STT brut, jamais perdre la dictée (cf.
// transcribeDictationAction, capture-actions.ts).

import { z } from 'zod'

export const NORMALIZE_CAPTION_ERROR_CODES = [
  'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_ERROR',
  'INVALID_RESPONSE', 'SCHEMA_VALIDATION_ERROR', 'EMPTY_RESPONSE',
  'CONFIG_ERROR', 'UNKNOWN_ERROR',
] as const
export type NormalizeCaptionErrorCode = (typeof NORMALIZE_CAPTION_ERROR_CODES)[number]

export type NormalizeCaptionResult =
  | { ok: true; caption: string }
  | { ok: false; errorCode: NormalizeCaptionErrorCode; errorDetail: string }

const GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
  },
  required: ['caption'],
}
const ResultSchema = z.object({ caption: z.string() })

// Prompt calibré sur les 7 cas de doctrine (voir tests/lib/ai/normalize-caption.test.ts) —
// ne pas reformuler sans repasser ces cas.
const SYSTEM_PROMPT = `Tu nettoies UNE dictée orale prise sur un chantier terrain (mine, forêt, BTP) pour
en faire une légende de photo courte et lisible.

Tu ne connais PAS la photo. Tu ne dois JAMAIS ajouter, déduire ou interpréter quoi que ce
soit qui n'est pas explicitement dans le texte dicté.

AUTORISÉ (nettoyage éditorial de la FORME uniquement) :
- retirer les hésitations et répétitions ("euh", "donc euh", "alors", un mot répété) ;
- ajouter la ponctuation et une syntaxe française naturelle ;
- retirer les amorces sans contenu ("alors voilà", "donc je dirais que", "en fait") ;
- produire une phrase courte adaptée à une légende terrain.

STRICTEMENT INTERDIT (jamais toucher au FOND) :
- ajouter un fait absent du texte dicté ;
- interpréter ou décrire la photo elle-même ;
- ajouter une action, une réserve ou une vigilance non formulée dans la dictée ;
- modifier un nom propre, un nombre, une unité, une date ou une mesure ;
- supprimer ou inverser une négation (« n'est toujours pas » doit rester une négation) ;
- transformer une hypothèse ou une incertitude (« peut-être », « il me semble », « environ »)
  en certitude ;
- changer le sens métier de la phrase.

En cas de doute entre nettoyer et conserver un mot, CONSERVE-le : un nettoyage manqué est
sans conséquence, un fait déformé ou un doute effacé ne l'est pas.

Exemples :
- "euh la fissure elle est toujours là quoi" -> "La fissure est toujours là."
- "R4 n'est toujours pas réglé" -> "R4 n'est toujours pas réglé."
- "peut-être une infiltration" -> "Peut-être une infiltration."
- "environ 12 mètres" -> "Environ 12 mètres." (jamais "12 mètres" seul, l'approximation
  doit rester visible)
- "SOTRAMEC a livré 3 palettes le 12 mars" -> "SOTRAMEC a livré 3 palettes le 12 mars."
  (nom propre, nombres et date inchangés)

Réponds uniquement en JSON.`

const TIMEOUT_MS = 20_000

function truncateDetail(msg: string): string {
  return msg.length > 500 ? msg.slice(0, 500) : msg
}

function fail(errorCode: NormalizeCaptionErrorCode, errorDetail: string): NormalizeCaptionResult {
  return { ok: false, errorCode, errorDetail: truncateDetail(errorDetail) }
}

/**
 * Nettoie éditorialement un transcript STT brut pour en faire une légende terrain.
 * Ne lève jamais — toute panne retourne un diagnostic typé, jamais un repli silencieux.
 * Le texte vide n'appelle pas le modèle (rien à nettoyer).
 */
export async function normalizeCaptionWithLLM(rawTranscript: string): Promise<NormalizeCaptionResult> {
  const trimmed = rawTranscript.trim()
  if (!trimmed) return { ok: true, caption: '' }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return fail('CONFIG_ERROR', 'GOOGLE_GENAI_API_KEY manquante')

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: trimmed }] }],
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    let resp: Response
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal },
      )
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return fail('TIMEOUT', `Timeout après ${TIMEOUT_MS}ms`)
      return fail('NETWORK_ERROR', e instanceof Error ? e.message : String(e))
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      if (resp.status === 429) return fail('RATE_LIMIT', `HTTP 429: ${text}`)
      return fail('PROVIDER_ERROR', `HTTP ${resp.status}: ${text}`)
    }

    const json = await resp.json()
    const rtext = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rtext) return fail('EMPTY_RESPONSE', 'Réponse Gemini sans texte exploitable')

    let raw: unknown
    try {
      raw = JSON.parse(rtext)
    } catch (e) {
      return fail('INVALID_RESPONSE', e instanceof Error ? e.message : String(e))
    }

    const parsed = ResultSchema.safeParse(raw)
    if (!parsed.success) return fail('SCHEMA_VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'schéma invalide')
    if (!parsed.data.caption.trim()) return fail('EMPTY_RESPONSE', 'Légende nettoyée vide')

    return { ok: true, caption: parsed.data.caption.trim() }
  } catch (e) {
    return fail('UNKNOWN_ERROR', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}
