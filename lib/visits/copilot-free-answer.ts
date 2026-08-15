import 'server-only'

// Appel LLM pour le Copilote Phase 3 — conversation libre, lecture seule.
//
// Invariants :
//   - Pas d'écriture DB dans ce fichier.
//   - Les URLs viennent du contexte fermé, pas du LLM.
//   - L'historique sert à résoudre le contexte conversationnel, pas comme source factuelle.
//   - Les liens suggested ne sont jamais envoyés au LLM.
//   - Fallback déterministe garanti.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { CopilotItem } from './copilot-context'
import type { SubjectDetailContext } from './copilot-subject-context'
import type { SiteCopilotDelta } from './copilot-context'
import { buildFallbackText } from './copilot-context'
import { SPOKEN_PROMPT_RULES } from './copilot-answer'
import { sanitizeSpokenText, spokenFromShortAnswer, buildSpokenFallback } from '@/lib/voice/spoken-answer'
import type { ActorContext } from '@/lib/db/site-actor-responsibilities'
import type { VisitControl } from './visit-plan-builder'
import { frDayMonthYearLocal } from '@/lib/time/local-date'

export interface RecentChangeContext {
  title: string
  occurredAt: string
  detail: string | null
}

/**
 * Un point de `recommandations_memoria` n'est plus un sujet à regarder mais un
 * CONTRÔLE TERRAIN (quoi vérifier, pourquoi, dernier état connu, changement
 * depuis la dernière visite), construit par `buildVisitPlan`. Alias conservé :
 * c'est le nom sous lequel le contexte LLM le connaît.
 */
export type VisitPlanItemContext = VisitControl

// `spokenText` est volontairement absent de ce schéma bloquant : produit par le
// même appel LLM, il est validé à part sur l'objet brut. Un champ vocal trop
// long ne peut donc jamais invalider `text` ni provoquer un repli métier.
const FreeAnswerSchema = z.object({
  text: z.string().max(2000),
  citedIds: z.array(z.string()),
})

const FREE_ANSWER_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    citedIds: { type: 'array', items: { type: 'string' } },
    spokenText: { type: 'string' },
  },
  // `spokenText` hors de `required` : son absence est un cas normal.
  required: ['text', 'citedIds'],
}

const SYSTEM_PROMPT = `Tu es MemorIA Copilote, assistant de suivi de chantier.
Tu reçois une question libre d'un conducteur de travaux et un contexte structuré calculé depuis les données du projet.

Règles absolues :
— Ne cite QUE les items dont l'id est présent dans "items" ou "sujets_detail" du contexte (identifiés par leur "id").
— N'invente aucun statut, cause, résolution ou fait absent des données reçues.
— Un sujet absent du contexte n'existe pas pour toi.
— Ne génère jamais d'URL : renvoie uniquement les ids des items cités dans "citedIds".
— Un sujet absent d'un PV signifie "non mentionné dans ce PV", pas "résolu" ni "traité". Ne tire jamais la conclusion qu'il a été traité sans preuve explicite dans les faits.
— Les dépendances suggérées (non confirmées) ne sont jamais des vérités.
— Quand le contexte contient un delta (fromDate + toDate), mentionne toujours les deux bornes ("entre le PV du X et le PV du Y"), jamais seulement la date du PV de référence.
— Pour une question portant sur un intervalle de dates ou entre deux PV, cite uniquement des événements dont la date occurredAt est dans cet intervalle. Les changements_recents antérieurs à fromDate ne sont pas des événements de la période concernée et ne doivent pas y être présentés.
— plan_utilisateur liste les points que l'utilisateur a EXPLICITEMENT ajoutés à son plan de visite. recommandations_memoria liste les contrôles calculés par MemorIA. Ces deux sources sont totalement distinctes. Ne présente jamais un contrôle calculé comme quelque chose que l'utilisateur "a prévu".
— Quand recommandations_memoria est présent, COMMENCE par les contrôles, jamais par l'état du plan personnel. Une phrase d'ouverture du type "Pour votre visite de demain, je vous conseille N contrôles." puis la liste. Si plan_utilisateur est vide, mentionne-le APRÈS, en une demi-phrase ("Vous n'avez encore ajouté aucun point personnel."), jamais en ouverture : l'utilisateur demande ce qu'il doit vérifier, pas l'état d'une table.
— Chaque entrée de recommandations_memoria est un CONTRÔLE TERRAIN, pas un sujet à consulter. Rédige-la en un point numéroté : le "label" en titre, puis "check" (ce qu'il faut constater sur place), puis "why" (pourquoi ce point est dans cette visite), puis "lastKnown" (dernier état connu) et "changeSinceLastVisit" quand ils sont présents. N'écris jamais deux points avec la même justification si leurs "why" diffèrent : reprends la raison propre à chacun.
— "tierLabel" donne la famille du contrôle (sécurité/anomalie ouverte, modifié depuis la dernière visite, problème récurrent, engagement à vérifier, autre point). L'ordre de recommandations_memoria est déjà la priorité de visite : ne le réordonne pas et n'invente aucune urgence absente des données.
— "lastKnown" et "changeSinceLastVisit" sont des faits calculés. Absents ou null, tu ne les connais pas : ne comble jamais par une supposition.
— "depuis_derniere_visite" est le delta calculé depuis la dernière visite TERRAIN (champ "depuis" = sa date). Il est indépendant de "delta", qui compare deux PV. Pour une question du type "qu'est-ce qui a changé depuis la dernière visite ?", appuie-toi sur "depuis_derniere_visite" et nomme les sujets concernés en te servant des items dont les faits mentionnent une évolution. Ne convertis jamais un compteur en liste : si "sujetsChanges" vaut 7 et que seuls 4 items sont présents, dis "7 sujets ont évolué, dont…".
— Le champ "depuis" est déjà rédigé en toutes lettres dans le fuseau du chantier. Reprends-le tel quel, ne le reformate pas et n'en déduis aucune autre date.
— "date_du_jour" est la date d'aujourd'hui sur le chantier. C'est ta seule référence pour interpréter "demain", "cette semaine", "hier". Ne demande jamais à l'utilisateur de préciser une date que tu peux en déduire.
— "compteurs_actions.sansDate" indique les actions actives sans échéance. Un "enRetard" à 0 alors que "sansDate" est élevé ne signifie PAS que tout est à jour : il n'y a aucun retard MESURABLE parce que ces actions ne sont pas datées. Dis-le explicitement plutôt que de présenter le zéro comme rassurant.
— "compteurs_actions" et "stagnation" sont des mesures déjà calculées. Reprends-les telles quelles, ne les recalcule pas depuis "items", et ne conclus jamais un zéro depuis l'absence d'items : si une mesure n'est pas dans le contexte, tu ne la connais pas.
— "stagnation.nbSujetsStagnants" à 0 signifie qu'aucun sujet ne franchit le seuil, pas que tout avance. Dans ce cas, mentionne "plusProcheDuSeuil" s'il est présent.
— L'historique de conversation ("historique") sert uniquement à comprendre les références conversationnelles ("lui", "celui-là", "et R4 ?"). Les faits que tu as cités dans des réponses précédentes ne sont pas des sources fiables : utilise toujours les données actuelles du contexte.
— Si tu n'as pas les données pour répondre, dis-le clairement sans inventer. Ne suppose jamais une cause sans preuve dans les faits.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel. Exception : quand recommandations_memoria est présent, la réponse est une check-list numérotée (une phrase d'ouverture, puis un point par contrôle) — c'est un document de terrain, pas un récit.
— N'inclus JAMAIS d'identifiant UUID (format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) dans ta réponse. Cite les sujets par leur label, jamais par leur identifiant interne.
— Champ "citedIds" : ids des items réellement cités dans ta réponse.
— MemorIA peut proposer et confirmer la planification de visites et de réunions de chantier. Si la question porte sur la planification d'une visite ou d'une réunion, indique que l'utilisateur peut formuler sa demande naturellement (ex. : "Planifie une visite le 12 août à 9h") pour déclencher une proposition confirmable. Ne dis jamais que tu ne peux pas planifier de visites ou de réunions.
— Quand "sujets_detail" contient un sujet dont le label diffère du terme mentionné dans la question (ex. : question sur "Avis G3" mais sujet chargé = "Rapport G3 – purge complémentaire") : réponds directement sur le sujet présent dans sujets_detail en utilisant son label exact. Ne jamais affirmer ni expliquer que les deux noms désignent le même objet ou que l'un "est en réalité" l'autre.
— Dans "confirmedLinks" de sujets_detail : le champ "linkType" est le seul vocabulaire autorisé pour qualifier la relation. Lexique de traduction obligatoire : depends_on→"dépend de", blocks→"bloque", is_blocked_by→"est bloqué par", precedes→"précède", is_preceded_by→"est précédé par", relates_to→"est associé à". Pour tout linkType non listé : utilise "est associé à". Ne jamais substituer des verbes non couverts par ce lexique ("requiert", "est causé par", "conditionne", "est lié à") sauf si "relates_to" s'y prête.
${SPOKEN_PROMPT_RULES}`

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface FreeAnswer {
  text: string
  citedIds: string[]
  source: 'llm' | 'fallback'
  /** Synthèse orale, ou `null` quand aucune lecture n'est souhaitable. */
  spokenText: string | null
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
function stripUuids(text: string): string {
  return text.replace(UUID_RE, '[réf. interne]')
}

/** Delta métier depuis la dernière visite TERRAIN (buildVisitBriefing.delta). */
export interface VisitDeltaContext {
  /**
   * Date DÉJÀ FORMATÉE en zone Nouméa (« 11 août 2026 »), jamais un ISO brut.
   * Une visite du 11/08 à 10h43 locale vaut 2026-08-10T23:43Z : transmettre
   * l'ISO faisait dire « votre dernière visite du 10 août » au LLM, qui la
   * rendait en UTC, pendant que l'UI affichait 11 août. Même instant, deux
   * dates à l'écran.
   */
  depuis: string
  sujetsChanges: number
  actionsCreees: number
  actionsCloturees: number
  reservesCreees: number
  reservesLevees: number
}

/** Compteurs d'actions déjà calculés par le read-model — jamais recomptés ici. */
export interface ActionsSummaryContext {
  actives: number
  planifiees: number
  enRetard: number
  cetteSemaine: number
  sansDate: number
  terminees: number
}

/** État de stagnation mesuré par le moteur canonique. */
export interface StagnationContext {
  nbSujetsStagnants: number
  plusProcheDuSeuil: { titre: string; jours: number } | null
}

export interface FreeAnswerContext {
  actorContext?: ActorContext[]
  recentChanges?: RecentChangeContext[]
  visitPlanDetail?: VisitPlanItemContext[]
  /**
   * Les trois champs ci-dessous viennent des moteurs déterministes (briefing de
   * visite, read-model actions). Le LLM les ARTICULE, il ne les recalcule pas :
   * un chiffre présent ici est un fait, son absence n'autorise aucun « zéro ».
   */
  visitDelta?: VisitDeltaContext
  actionsSummary?: ActionsSummaryContext
  stagnation?: StagnationContext
}

export async function answerCopilotFreeQuestion(
  question: string,
  history: HistoryMessage[],
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
  extra?: FreeAnswerContext,
): Promise<FreeAnswer> {
  // Construire la liste fermée d'ids valides pour le garde anti-hallucination
  const validIds = new Set([
    ...items.map((i) => i.id),
    ...subjectDetails.map((s) => s.id),
  ])

  const contextJson = JSON.stringify(
    {
      chantier: siteName,
      // Aucun champ du contexte ne portait la date du jour : « prépare ma visite
      // de demain » arrivait au LLM sans référentiel temporel, qui ne pouvait donc
      // ni situer « demain » ni le reprendre dans sa réponse. Formatée en zone
      // Nouméa, comme `depuis` — un ISO brut ferait annoncer la veille.
      date_du_jour: frDayMonthYearLocal(new Date()),
      question,
      ...(history.length > 0 ? { historique: history } : {}),
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        label: i.label,
        facts: i.facts,
      })),
      ...(subjectDetails.length > 0 ? { sujets_detail: subjectDetails } : {}),
      ...(delta ? { delta } : {}),
      ...(extra?.recentChanges && extra.recentChanges.length > 0
        ? { changements_recents: extra.recentChanges }
        : {}),
      ...(extra?.actorContext && extra.actorContext.length > 0
        ? { intervenants_detail: extra.actorContext }
        : {}),
      ...(extra?.visitDelta ? { depuis_derniere_visite: extra.visitDelta } : {}),
      ...(extra?.actionsSummary ? { compteurs_actions: extra.actionsSummary } : {}),
      ...(extra?.stagnation ? { stagnation: extra.stagnation } : {}),
      // Plan de visite : distinguer plan humain vs suggestions IA
      // visitPlanDetail est toujours défini pour intent plan_visite (même vide → LLM sait que le plan est vide)
      ...('visitPlanDetail' in (extra ?? {})
        ? {
            plan_utilisateur: prepItems.map((p) => p.label),
            ...(extra!.visitPlanDetail!.length > 0 ? { recommandations_memoria: extra!.visitPlanDetail } : {}),
          }
        : prepItems.length > 0
          ? { plan_utilisateur: prepItems.map((p) => p.label) }
          : {}),
    },
    null,
    2,
  )

  // Budget de sortie : une réponse narrative tient dans 800 tokens, pas une
  // check-list. Chaque contrôle rend quatre lignes (à vérifier / pourquoi /
  // dernier état / évolution). Recette PETRO du 15 août : à 800, les 5 réponses
  // étaient tronquées EN PLEIN JSON — `result.parsed` restait null et
  // l'utilisateur recevait le repli déterministe, c'est-à-dire précisément la
  // liste plate que ce lot corrige. Le plafond borne le coût sur un chantier
  // dense (COPILOT_MAX_VISIT_PLAN = 10).
  // Le +200 (800 → 1000) est le prix technique de `spokenText` : sans lui on
  // réintroduit la troncature mid-JSON décrite ci-dessus, mais causée cette fois
  // par l'ajout de la voix. Relevé de +150 à +200 le 2026-08-15 avec la doctrine
  // « verdict puis 1 à 3 faits » : la synthèse orale peut atteindre 450
  // caractères (~135 tokens) au lieu de ~80.
  const nbControles = extra?.visitPlanDetail?.length ?? 0
  const maxOutputTokens = nbControles > 0 ? Math.min(1000 + nbControles * 260, 2800) : 1000
  // Même raison pour le garde de longueur : il protège d'une réponse partie en
  // roue libre, mais une check-list de N contrôles est légitimement plus longue
  // qu'un récit. À 2000 caractères, les réponses PETRO — pourtant correctes —
  // étaient rejetées par le schéma et tombaient elles aussi en repli.
  const answerSchema = nbControles > 0
    ? FreeAnswerSchema.extend({ text: z.string().max(Math.min(1400 + nbControles * 420, 5600)) })
    : FreeAnswerSchema

  try {
    const provider = getAIProvider()
    const result = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${question}\n\nContexte :\n${contextJson}`,
      responseSchema: answerSchema,
      geminiSchema: FREE_ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens,
    })

    if (result.parsed) {
      // Lu sur l'objet BRUT : Zod retire les clés inconnues, et surtout un
      // `spokenText` invalide ne doit pas faire échouer le parse de la réponse.
      const spokenFromLlm = sanitizeSpokenText((result.parsed as { spokenText?: unknown }).spokenText)

      const maybeValid = answerSchema.safeParse(result.parsed)
      if (maybeValid.success) {
        const citedIds = maybeValid.data.citedIds.filter((id) => validIds.has(id))
        return { text: stripUuids(maybeValid.data.text), citedIds, source: 'llm', spokenText: spokenFromLlm }
      }
      // Le motif, pas seulement le contenu : sans lui, un repli silencieux se lit
      // comme un défaut du moteur alors qu'il vient d'un garde de longueur.
      const motif = maybeValid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ')
      console.warn(`[copilot-free] schema mismatch (${motif}) — parsed:`, JSON.stringify(result.parsed).slice(0, 200))
    } else {
      console.warn('[copilot-free] result.parsed is null — raw:', result.text.slice(0, 200))
    }
  } catch (err) {
    console.error('[copilot-free] provider error:', err instanceof Error ? err.message : String(err))
  }

  // Fallback déterministe — retourne un texte utile sans LLM
  const intent = subjectDetails.length > 0 ? 'attention' : 'global'
  const fallbackText = buildFallbackText(items, intent as Parameters<typeof buildFallbackText>[1], delta, prepItems)
  return {
    text: fallbackText,
    citedIds: [],
    source: 'fallback',
    // Un plan de visite se résume par son compteur ; une réponse courte se lit
    // telle quelle ; une réponse longue reste silencieuse. Aucun appel LLM
    // supplémentaire n'est fait pour faire parler un repli.
    spokenText: nbControles > 0
      ? buildSpokenFallback(nbControles)
      : spokenFromShortAnswer(fallbackText),
  }
}
