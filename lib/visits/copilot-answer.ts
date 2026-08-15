import 'server-only'

// Appel LLM pour le Copilote Phase 2 — lecture seule, sourcé.
// Contrat : le LLM reçoit un JSON déterministe et renvoie texte + ids cités.
// Les URLs ne sont JAMAIS générées par le LLM : elles viennent du contexte fermé.
// Fallback déterministe garanti si le provider échoue.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { CopilotIntent, CopilotItem, SiteCopilotDelta } from './copilot-context'
import { buildFallbackText } from './copilot-context'
import { sanitizeSpokenText, spokenFromShortAnswer, buildSpokenFallback } from '@/lib/voice/spoken-answer'

// Schéma de réponse structurée — le LLM renvoie UNIQUEMENT texte + ids fermés.
//
// `spokenText` en est VOLONTAIREMENT absent. Il est produit par le même appel
// (voir le schéma Gemini ci-dessous) mais validé à part, sur l'objet brut : un
// champ vocal trop long ou mal typé ne doit jamais invalider la réponse métier
// ni déclencher un repli. La voix est un enrichissement, pas une condition.
const AnswerSchema = z.object({
  text: z.string().max(1500),
  citedIds: z.array(z.string()),
})

// Schéma JSON natif passé à Gemini pour forcer la structure de sortie.
// Évite les variations de nommage (cited_ids vs citedIds) qui causent un fallback silencieux.
const ANSWER_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    citedIds: { type: 'array', items: { type: 'string' } },
    spokenText: { type: 'string' },
  },
  // `spokenText` hors de `required` : son absence est un cas normal.
  required: ['text', 'citedIds'],
}

/**
 * Contrat oral, commun aux deux moteurs. Le LLM produit la synthèse dans le
 * MÊME appel que la réponse : pas de second appel, pas de second raisonnement.
 *
 * Révision du 2026-08-15 (retour terrain Vincent) : la V1 demandait « le nombre,
 * l'essentiel, et renvoie au détail affiché ». Résultat entendu au chantier :
 * « Rien n'est urgent, certains sujets stagnent, consultez le détail à
 * l'écran » — une notification vocale de l'interface, pas l'analyse de MemorIA,
 * alors même que le moteur savait QUELS sujets stagnaient et depuis combien de
 * passages. La mission du champ est donc redéfinie : répondre à la question en
 * hiérarchisant, et non décrire la réponse écrite. L'écran et la voix ne sont
 * pas deux systèmes concurrents — la voix donne l'essentiel, l'écran conserve
 * les preuves — donc la voix n'a pas à renvoyer à l'écran.
 */
export const SPOKEN_PROMPT_RULES = `
Champ "spokenText" : ta RÉPONSE ORALE à la question, prononcée pendant que le texte complet s'affiche. Ce n'est ni un résumé de ta réponse écrite, ni sa description : c'est ce que tu dirais à voix haute si le conducteur de travaux te posait la question en marchant sur le chantier.
— Quand tu as de la matière, structure ainsi : le verdict, puis les 1 à 3 éléments les plus importants, puis ce qui les rend importants. Hiérarchiser est précisément le travail attendu de toi.
— Nomme les sujets et donne le fait qui les distingue ("sans changement depuis quatre passages", "revient depuis deux visites"). Un compteur seul ne renseigne personne.
— La longueur est commandée par la question, jamais par un gabarit. Une question fermée appelle une ou deux phrases ; une question large ("où en est le chantier ?") en tolère trois ou quatre. Plafond absolu : 30 secondes de parole.
— N'énumère pas tout. Ce qui n'entre pas dans la hiérarchie reste à l'écran, sans que tu aies à le signaler.
— NE DIS JAMAIS "le détail est affiché", "consultez l'écran", "vous trouverez ci-dessous", ni aucune formule équivalente. L'utilisateur a l'écran sous les yeux. Termine sur ta réponse.
— Aucune formule d'accueil ("Bien sûr", "Voici", "Je serais ravi de").
— Français parlé, naturel, direct. Aucun markdown, aucune énumération numérotée, aucune référence technique, aucun identifiant.
— Uniquement des faits déjà présents dans ta réponse et dans le contexte. Ce champ n'est jamais une source de vérité supplémentaire.
— Si, et seulement si, rien ne peut être raisonnablement hiérarchisé (contexte vide, mesure indisponible), une phrase générique et honnête suffit.`

const SYSTEM_PROMPT = `Tu es MemorIA Copilote, assistant de suivi de chantier.
Tu reçois un contexte JSON structuré, calculé de façon déterministe depuis les données du projet.

Règles absolues :
— Ne cite QUE les items présents dans le champ "items" du contexte (identifiés par leur "id").
— N'invente aucun statut, aucune cause, aucune résolution absente des faits.
— Un sujet absent du contexte n'existe pas pour toi.
— Ne génère jamais d'URL : renvoie uniquement les ids des items cités dans "citedIds".
— Un sujet absent d'un PV signifie "non mentionné dans ce PV", pas "résolu" ni "traité". Ne tire jamais la conclusion qu'il a été traité sans preuve explicite dans les faits.
— Les dépendances suggérées (non confirmées) ne sont jamais des vérités.
— Quand le contexte contient un delta (fromDate + toDate), mentionne toujours les deux bornes ("entre le PV du X et le PV du Y"), jamais seulement la date du PV de référence.
— Un item de type "deadline" dont la date est passée n'est pas "en retard" au sens opérationnel : décris-le factuellement ("échéance datée au X, toujours en attente") sans employer le terme "en retard" ni inférer de retard si aucun fait ne le confirme explicitement.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel.
— Champ "citedIds" : liste les ids des items réellement cités dans ta réponse.
${SPOKEN_PROMPT_RULES}`

const INTENT_PROMPTS: Record<CopilotIntent, string> = {
  attention:
    "Quels sujets ou problèmes méritent l'attention du conducteur de travaux maintenant ? Explique brièvement pourquoi chaque sujet est prioritaire, en t'appuyant uniquement sur les faits du contexte.",
  changes:
    "Qu'est-ce qui a changé récemment sur ce chantier ? Appuie-toi sur le delta inter-PV et les changements récents présents dans le contexte.",
  stale:
    "Quels sujets traînent sans évolution sur ce chantier ? Identifie ce qui bloque ou stagne, uniquement à partir des données du contexte.",
  // Règle d'invariance : la sélection des sujets est déterministe (moteur).
  // Le LLM formule uniquement — il NE choisit PAS quels sujets mentionner.
  // Tout item du contexte DOIT apparaître dans la réponse, dans l'ordre fourni.
  next_visit:
    "Présente les vérifications à effectuer lors de la prochaine visite.\n\nRègle absolue : cite CHACUN des items présents dans le champ « items » du contexte, dans leur ordre exact. Aucun item ne peut être omis. Pour chaque item : une courte phrase indiquant le label et le motif principal issu de ses « facts ». Si un planDeVisite est présent, commence par lui.",
}

export interface CopilotAnswer {
  text: string
  citedIds: string[]  // ids validés contre la liste fermée du contexte
  /**
   * llm         — réponse LLM, sélection et texte fournis par le modèle
   * fallback     — LLM indisponible (erreur provider / schema invalide)
   * deterministic — LLM disponible mais réponse incomplète : le moteur
   *                prend le relais pour garantir la couverture des items
   */
  source: 'llm' | 'fallback' | 'deterministic'
  /**
   * Synthèse orale, ou `null` quand aucune lecture n'est souhaitable. Jamais
   * une source de vérité : le texte reste la restitution canonique.
   */
  spokenText: string | null
}

export async function answerCopilotQuestion(
  items: CopilotItem[],
  intent: CopilotIntent,
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
): Promise<CopilotAnswer> {
  const contextJson = JSON.stringify(
    {
      chantier: siteName,
      intent,
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        label: i.label,
        facts: i.facts,
      })),
      ...(delta ? { delta } : {}),
      ...(prepItems.length > 0 ? { planDeVisite: prepItems.map((p) => p.label) } : {}),
    },
    null,
    2,
  )

  try {
    const provider = getAIProvider()
    const result = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${INTENT_PROMPTS[intent]}\n\nContexte :\n${contextJson}`,
      responseSchema: AnswerSchema,
      geminiSchema: ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      // 600 → 750 → 800. `spokenText` coûte des tokens de SORTIE : sans marge,
      // une réponse dense est tronquée EN PLEIN JSON, `result.parsed` reste null
      // et l'utilisateur reçoit le repli déterministe — une régression du TEXTE
      // causée par l'ajout de la voix.
      // Le passage à 800 accompagne la doctrine « verdict puis 1 à 3 faits » :
      // la synthèse peut désormais atteindre 450 caractères (~135 tokens) contre
      // ~80 auparavant. Garder 750 aurait saturé la marge et réintroduit la
      // troncature — la voix aurait à nouveau dégradé le texte.
      maxOutputTokens: 800,
    })

    if (result.parsed) {
      // Lu sur l'objet BRUT, pas sur `maybeValid.data` : Zod retire les clés
      // inconnues. C'est ce qui rend la validation vocale indépendante.
      const spokenFromLlm = sanitizeSpokenText((result.parsed as { spokenText?: unknown }).spokenText)

      const maybeValid = AnswerSchema.safeParse(result.parsed)
      if (maybeValid.success) {
        // Validation des ids contre la liste fermée — le LLM ne peut pas inventer d'id
        const validIds = new Set(items.map((i) => i.id))
        const citedIds = maybeValid.data.citedIds.filter((id) => validIds.has(id))

        // Invariant next_visit : TOUS les items doivent être cités.
        // Si le LLM n'en a mentionné qu'une partie, le moteur prend le relais.
        // Le texte peut varier légèrement d'un run à l'autre ; la SÉLECTION ne le peut pas.
        if (intent === 'next_visit' && citedIds.length < items.length) {
          console.warn('[copilot] next_visit incomplete citation — cited:', citedIds.length, '/ expected:', items.length, '— using deterministic')
          return {
            text: buildFallbackText(items, intent, null, prepItems),
            citedIds: items.map((i) => i.id),
            source: 'deterministic',
            // Le texte du LLM est écarté, donc sa synthèse orale aussi : elle
            // décrirait une réponse qui n'est plus celle affichée. Le gabarit
            // déterministe prend le relais pour que MemorIA ne devienne pas
            // muette au moment précis où le garde protège la vérité.
            spokenText: buildSpokenFallback(items.length),
          }
        }

        return { text: maybeValid.data.text, citedIds, source: 'llm', spokenText: spokenFromLlm }
      }
      // Le JSON est là mais ne correspond pas au schéma attendu
      console.warn('[copilot] schema mismatch — parsed:', JSON.stringify(result.parsed).slice(0, 200))
    } else {
      console.warn('[copilot] result.parsed is null — raw text:', result.text.slice(0, 200))
    }

    return fallbackAnswer(items, intent, delta, prepItems)
  } catch (err) {
    // Provider IA indisponible (timeout, quota, réseau) → réponse déterministe utile
    console.error('[copilot] provider error:', err instanceof Error ? err.message : String(err))
    return fallbackAnswer(items, intent, delta, prepItems)
  }
}

/**
 * Repli déterministe, voix comprise — sans LLM.
 * Un plan de visite se résume par son compteur ; une réponse courte se lit
 * telle quelle ; tout le reste reste silencieux plutôt que de faire réciter une
 * liste à voix haute.
 */
function fallbackAnswer(
  items: CopilotItem[],
  intent: CopilotIntent,
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
): CopilotAnswer {
  const text = buildFallbackText(items, intent, delta, prepItems)
  return {
    text,
    citedIds: [],
    source: 'fallback',
    spokenText: intent === 'next_visit'
      ? buildSpokenFallback(items.length)
      : spokenFromShortAnswer(text),
  }
}
