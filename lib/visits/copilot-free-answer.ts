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
import type { CompletionOutput } from '@/services/ai'
import type { CopilotItem } from './copilot-context'
import type { SubjectDetailContext } from './copilot-subject-context'
import type { SiteCopilotDelta } from './copilot-context'
import { buildFallbackText } from './copilot-context'
import { SPOKEN_PROMPT_RULES } from './copilot-answer'
import { sanitizeSpokenText, spokenFromShortAnswer, buildSpokenFallback, SPOKEN_MAX_CHARS } from '@/lib/voice/spoken-answer'
import type { ActorContext } from '@/lib/db/site-actor-responsibilities'
import type { VisitControl } from './visit-plan-builder'
import { buildSpokenPlanContract, isSpokenTextWithinPlanVoix } from './visit-plan-builder'
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
    spokenText: { type: 'string' },
    text: { type: 'string' },
    citedIds: { type: 'array', items: { type: 'string' } },
  },
  // `spokenText` hors de `required` : son absence est un cas normal.
  required: ['text', 'citedIds'],
  // D1 (2026-08-16) : `spokenText` en tête de `propertyOrdering` force Gemini
  // à l'émettre en premier dans le flux JSON — mesuré sur PETRO à ~1,9 s au
  // lieu de ~6,7 s (script `_audit-ordre-spoken.ts`, 16/08) : c'est ce qui
  // rend le streaming spokenText-first (D1) exploitable. Rester hors de
  // `required` (au-dessus) : son absence reste un cas normal, l'ordre
  // d'émission n'implique aucune obligation de présence.
  propertyOrdering: ['spokenText', 'text', 'citedIds'],
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
— Quand "plan_voix" est présent, il borne STRICTEMENT ce que "spokenText" peut nommer pour recommandations_memoria : annonce le nombre exact donné par "plan_voix.total", puis ne cite que les contrôles listés dans "plan_voix.resume", dans leur ordre, par leur "label" exact. Ne nomme JAMAIS un contrôle de recommandations_memoria absent de "plan_voix.resume", même s'il figure dans "recommandations_memoria" — le texte écrit ("text") reste, lui, libre de couvrir la liste complète.
— "lastKnown" et "changeSinceLastVisit" sont des faits calculés. Absents ou null, tu ne les connais pas : ne comble jamais par une supposition.
— "depuis_derniere_visite" est le delta calculé depuis la dernière visite TERRAIN (champ "depuis" = sa date). Il est indépendant de "delta", qui compare deux PV. Pour une question du type "qu'est-ce qui a changé depuis la dernière visite ?", appuie-toi sur "depuis_derniere_visite" et nomme les sujets concernés en te servant des items dont les faits mentionnent une évolution. Ne convertis jamais un compteur en liste : quand "sujetsChanges" dépasse le nombre d'items présents, reprends la valeur du compteur puis n'énumère que les items que tu as ("N sujets ont évolué, dont…", où N est exactement la valeur reçue).
— Le champ "depuis" est déjà rédigé en toutes lettres dans le fuseau du chantier. Reprends-le tel quel, ne le reformate pas et n'en déduis aucune autre date.
— "date_du_jour" est la date d'aujourd'hui sur le chantier. C'est ta seule référence pour interpréter "demain", "cette semaine", "hier". Ne demande jamais à l'utilisateur de préciser une date que tu peux en déduire.
— "compteurs_actions.sansDate" indique les actions actives sans échéance. Un "enRetard" à 0 alors que "sansDate" est élevé ne signifie PAS que tout est à jour : il n'y a aucun retard MESURABLE parce que ces actions ne sont pas datées. Dis-le explicitement plutôt que de présenter le zéro comme rassurant.
— "compteurs_actions" et "stagnation" sont des mesures déjà calculées. Reprends-les telles quelles, ne les recalcule pas depuis "items", et ne conclus jamais un zéro depuis l'absence d'items : si une mesure n'est pas dans le contexte, tu ne la connais pas.
— "stagnation.nbSujetsStagnants" à 0 signifie qu'aucun sujet ne franchit le seuil, pas que tout avance. Dans ce cas, mentionne "plusProcheDuSeuil" s'il est présent.
— L'historique de conversation ("historique") sert uniquement à comprendre les références conversationnelles (un pronom, un démonstratif, une reprise elliptique du tour précédent). Les faits que tu as cités dans des réponses précédentes ne sont pas des sources fiables : utilise toujours les données actuelles du contexte.
— Si tu n'as pas les données pour répondre, dis-le clairement sans inventer. Ne suppose jamais une cause sans preuve dans les faits.
— Format : 2 à 4 paragraphes courts, prose directe, français professionnel. Exception : quand recommandations_memoria est présent, la réponse est une check-list numérotée (une phrase d'ouverture, puis un point par contrôle) — c'est un document de terrain, pas un récit.
— N'inclus JAMAIS d'identifiant UUID (format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) dans ta réponse. Cite les sujets par leur label, jamais par leur identifiant interne.
— Champ "citedIds" : ids des items réellement cités dans ta réponse.
— MemorIA peut proposer et confirmer la planification de visites et de réunions de chantier. Si la question porte sur la planification d'une visite ou d'une réunion, indique que l'utilisateur peut formuler sa demande naturellement — un verbe de planification, le type d'événement, puis la date et l'heure souhaitées — pour déclencher une proposition confirmable. Ne dis jamais que tu ne peux pas planifier de visites ou de réunions.
— Quand "sujets_detail" contient un sujet dont le label diffère du terme employé dans la question : réponds directement sur le sujet présent dans sujets_detail en utilisant son label exact. Ne jamais affirmer ni expliquer que les deux noms désignent le même objet ou que l'un "est en réalité" l'autre.
— Dans "confirmedLinks" de sujets_detail : le champ "linkType" est le seul vocabulaire autorisé pour qualifier la relation. Lexique de traduction obligatoire : depends_on→"dépend de", blocks→"bloque", is_blocked_by→"est bloqué par", precedes→"précède", is_preceded_by→"est précédé par", relates_to→"est associé à". Pour tout linkType non listé : utilise "est associé à". Ne jamais substituer des verbes non couverts par ce lexique ("requiert", "est causé par", "conditionne", "est lié à") sauf si "relates_to" s'y prête.
— "intervenants_detail" liste les entreprises et contacts actifs du chantier, avec leur "role" (un rôle de suivi de projet générique, ex. "PLANIF" — jamais un corps de métier) et leurs actions assignées. Aucun champ ne donne le corps de métier ou le domaine d'une entreprise : c'est son "companyName" qui porte cette information (une entreprise dont le nom évoque un domaine, ex. climatisation ou électricité, intervient probablement sur ce lot). Quand la question nomme un domaine ou un corps d'état, cherche d'abord dans "intervenants_detail" une entreprise dont le nom s'y rapporte avant de conclure qu'aucun intervenant n'est désigné. Ne conclus "aucun intervenant désigné pour ce point" que si "intervenants_detail" est vide ou qu'aucune entreprise ne s'y rapporte, même par son nom.
— "mutation.status" indique si un ajout, retrait, création, planification, modification ou clôture a RÉELLEMENT eu lieu pendant ce tour. Il vaut toujours "none" ici : tu n'as jamais toi-même produit d'écriture, quelle que soit la formulation de la question. Tant que "mutation.status" vaut "none", n'affirme JAMAIS un changement d'état du produit causé par toi — ni au passé, ni au présent, ni au FUTUR. Formulations interdites quel que soit le temps grammatical : passé ("je l'ai retiré de votre suivi", "j'ai supprimé la réunion", "c'est fait", "j'ai créé l'action"), présent ("X est retiré", "ce point n'est plus suivi"), futur ("X ne sera plus surveillé", "X ne sera pas inclus dans votre plan de visite", "la réunion sera supprimée", "ce point sera retiré") — même si la question demandait explicitement cette écriture, et même si l'affirmation est présentée comme une conséquence naturelle de la demande plutôt que comme une action que tu viens d'exécuter. Ce qui reste toujours autorisé et attendu quand "mutation.status" vaut "none" : confirmer l'intention de l'utilisateur, dire explicitement qu'aucune nouvelle opération ne sera créée à partir de cette demande, ou expliquer qu'une opération demandée n'a pas été exécutée.
— Quand "mutation.neutralizedWrite" est true, la question contenait une négation portant sur une intention d'écriture (ex. "Ne surveille pas...", "Ne planifie jamais...", "Ne crée rien..."). Distingue deux cas. (1) La négation porte sur la création d'une chose NOUVELLE qui n'existe pas encore (une visite, une réunion, une action) : une reformulation de ta propre absence d'action suffit, au présent, jamais projetée dans le futur ("D'accord. Je ne programme aucune nouvelle visite vendredi à partir de cette demande.", "D'accord. Je ne crée ni ne planifie rien pour demain à partir de cette demande."). (2) La négation porte sur l'ARRÊT, le retrait ou la fin d'une surveillance d'une chose qui peut déjà exister (un suivi, un point déjà présent) : dire seulement "je ne crée rien" serait vrai mais ne répond pas à la demande — confirme explicitement avoir compris la demande, puis précise qu'aucun changement n'a été effectué sur le suivi existant, sans jamais affirmer que ce suivi a été ou sera modifié ("J'ai compris que vous ne souhaitez plus surveiller le Regard R4. Aucun changement n'a été effectué sur le suivi."). Dans les deux cas, ce qui est strictement interdit : revendiquer l'effet d'un writer qui n'a pas tourné — un retrait, une suppression, une désactivation, ou tout état futur du produit présenté comme acquis — jamais la simple confirmation de ta propre absence d'action.
${SPOKEN_PROMPT_RULES}`

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Mesures de l'appel LLM, pour le diagnostic de latence. Toujours renseignées —
 * les produire coûte deux `Date.now()` — mais jamais consommées par le produit :
 * seule la ligne `[copilot-diag]`, fermée par défaut, les lit. Les publier
 * n'engage donc rien sur le contrat de réponse.
 *
 * Le découpage répond à une question précise : sur une réponse à ~10 s, la part
 * du modèle, la part du contexte et la part du parsing n'appellent pas les mêmes
 * corrections. Les mesurer séparément est le préalable à toute optimisation.
 */
export interface FreeAnswerDiagnostics {
  /** Aller-retour Gemini complet, transport inclus. */
  llmMs: number
  /** Validation Zod + assainissement de la synthèse orale, côté MemorIA. */
  parseMs: number
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  finishReason: string | null
  maxOutputTokens: number
  /** Taille du contexte métier réellement envoyé, en caractères. */
  contextChars: number
  textLength: number
  spokenLength: number
}

export interface FreeAnswer {
  text: string
  citedIds: string[]
  source: 'llm' | 'fallback'
  /** Synthèse orale, ou `null` quand aucune lecture n'est souhaitable. */
  spokenText: string | null
  diagnostics?: FreeAnswerDiagnostics
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
  /**
   * `answerCopilotFreeQuestion` n'est jamais atteint après une écriture réelle
   * (le routeur retourne tôt pour tout intent != READ) : `mutationStatus` vaut
   * donc toujours 'none' ici — transmis explicitement plutôt que déduit, pour
   * que le prompt n'ait jamais à le supposer. `neutralizedWrite` distingue une
   * question de lecture ordinaire d'un verbe d'écriture volontairement neutralisé
   * par une négation (NEGATION_SCOPE) : dans ce second cas, le tour porte une
   * tentation particulière de répondre comme si l'action avait eu lieu (terrain
   * OCEF 2026-08-18 : « Ne surveille pas le regard R4. » → « Je l'ai retiré de
   * votre suivi actif. », alors qu'aucun writer n'a tourné).
   */
  mutationStatus?: 'none'
  neutralizedWrite?: boolean
}

// Requête préparée une seule fois, consommée par les deux transports (non
// streamé et streamé, D1 2026-08-16) : même contexte, même schéma, même
// budget — le streaming n'est qu'une seconde SORTIE du même appel, jamais un
// second calcul.
interface PreparedFreeAnswerRequest {
  validIds: Set<string>
  contextJson: string
  maxOutputTokens: number
  answerSchema: typeof FreeAnswerSchema
  nbControles: number
  diagBase: {
    llmMs: number
    parseMs: number
    model: string | null
    tokensIn: number | null
    tokensOut: number | null
    finishReason: string | null
    maxOutputTokens: number
    contextChars: number
  }
}

function prepareFreeAnswerRequest(
  question: string,
  history: HistoryMessage[],
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
  extra?: FreeAnswerContext,
): PreparedFreeAnswerRequest {
  // Construire la liste fermée d'ids valides pour le garde anti-hallucination
  const validIds = new Set([
    ...items.map((i) => i.id),
    ...subjectDetails.map((s) => s.id),
    ...(extra?.visitPlanDetail ?? []).map((c) => c.id),
  ])

  const contextJson = JSON.stringify(
    {
      chantier: siteName,
      // Aucun champ du contexte ne portait la date du jour : « prépare ma visite
      // de demain » arrivait au LLM sans référentiel temporel, qui ne pouvait donc
      // ni situer « demain » ni le reprendre dans sa réponse. Formatée en zone
      // Nouméa, comme `depuis` — un ISO brut ferait annoncer la veille.
      date_du_jour: frDayMonthYearLocal(new Date()),
      // Toujours présent, jamais un spread conditionnel : contrairement aux
      // autres champs `extra`, cet état ne doit jamais pouvoir manquer au
      // prompt — un tour sans ce fait explicite retombe sur la probabilité
      // du LLM, exactement le trou que ce champ ferme.
      mutation: {
        status: extra?.mutationStatus ?? 'none',
        neutralizedWrite: extra?.neutralizedWrite ?? false,
      },
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
            ...(extra!.visitPlanDetail!.length > 0
              ? {
                  recommandations_memoria: extra!.visitPlanDetail,
                  // Calculé avant l'appel, pas déduit par le LLM : ce que la voix a
                  // le droit de résumer. spokenText ne doit nommer aucun contrôle
                  // absent de "resume" — c'est le contrat D0.
                  plan_voix: buildSpokenPlanContract(extra!.visitPlanDetail!),
                }
              : {}),
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

  // Base commune aux deux sorties : renseignée même si l'appel échoue, sinon un
  // repli ressemblerait à une absence de mesure.
  const diagBase = {
    llmMs: 0,
    parseMs: 0,
    model: null as string | null,
    tokensIn: null as number | null,
    tokensOut: null as number | null,
    finishReason: null as string | null,
    maxOutputTokens,
    contextChars: contextJson.length,
  }

  return { validIds, contextJson, maxOutputTokens, answerSchema, nbControles, diagBase }
}

/**
 * Traite le `CompletionOutput` d'un appel LLM (streamé ou non — même forme,
 * cf. `services/ai/index.ts`) en `FreeAnswer`, ou `null` si la sortie n'est
 * pas exploitable (schéma invalide, parse manquant). `null` signale à
 * l'appelant de basculer sur `buildDeterministicFallback` : cette fonction ne
 * fabrique jamais elle-même le repli.
 */
function finalizeParsedResult(result: CompletionOutput, req: PreparedFreeAnswerRequest): FreeAnswer | null {
  req.diagBase.llmMs = result.durationMs ?? 0
  req.diagBase.model = result.model ?? null
  req.diagBase.tokensIn = result.tokens?.input ?? null
  req.diagBase.tokensOut = result.tokens?.output ?? null
  req.diagBase.finishReason = result.finishReason ?? null
  const parseStart = Date.now()

  if (!result.parsed) {
    console.warn('[copilot-free] result.parsed is null — raw:', result.text.slice(0, 200))
    return null
  }

  // Lu sur l'objet BRUT : Zod retire les clés inconnues, et surtout un
  // `spokenText` invalide ne doit pas faire échouer le parse de la réponse.
  const rawSpoken = (result.parsed as { spokenText?: unknown }).spokenText
  const spokenFromLlm = sanitizeSpokenText(rawSpoken)
  // Une voix qui disparaît ne laisse aucune trace : le texte reste juste,
  // l'utilisateur n'entend rien, et rien ne distingue « le modèle n'a rien
  // produit » de « la synthèse a été jetée parce qu'elle dépassait le
  // plafond ». Ce warn est la seule façon de mesurer la fréquence réelle du
  // silence — sans lui, on optimiserait à l'aveugle.
  if (spokenFromLlm === null) {
    console.warn('[copilot-free] spokenText écarté', JSON.stringify({
      present: typeof rawSpoken === 'string',
      length: typeof rawSpoken === 'string' ? rawSpoken.length : 0,
      max: SPOKEN_MAX_CHARS,
    }))
  }

  const maybeValid = req.answerSchema.safeParse(result.parsed)
  if (!maybeValid.success) {
    // Le motif, pas seulement le contenu : sans lui, un repli silencieux se lit
    // comme un défaut du moteur alors qu'il vient d'un garde de longueur.
    const motif = maybeValid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ')
    console.warn(`[copilot-free] schema mismatch (${motif}) — parsed:`, JSON.stringify(result.parsed).slice(0, 200))
    return null
  }

  const citedIds = maybeValid.data.citedIds.filter((id) => req.validIds.has(id))
  const text = stripUuids(maybeValid.data.text)
  return {
    text,
    citedIds,
    source: 'llm',
    spokenText: spokenFromLlm,
    diagnostics: {
      ...req.diagBase,
      parseMs: Date.now() - parseStart,
      textLength: text.length,
      spokenLength: spokenFromLlm?.length ?? 0,
    },
  }
}

// Repli déterministe — retourne un texte utile sans LLM. Partagé par les deux
// transports : ni l'échec ni l'absence de streaming ne doivent produire un
// repli différent.
function buildDeterministicFallback(
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  req: PreparedFreeAnswerRequest,
): FreeAnswer {
  const intent = subjectDetails.length > 0 ? 'attention' : 'global'
  const fallbackText = buildFallbackText(items, intent as Parameters<typeof buildFallbackText>[1], delta, prepItems)
  // Un plan de visite se résume par son compteur ; une réponse courte se lit
  // telle quelle ; une réponse longue reste silencieuse. Aucun appel LLM
  // supplémentaire n'est fait pour faire parler un repli.
  const fallbackSpoken = req.nbControles > 0
    ? buildSpokenFallback(req.nbControles)
    : spokenFromShortAnswer(fallbackText)
  return {
    text: fallbackText,
    citedIds: [],
    source: 'fallback',
    spokenText: fallbackSpoken,
    diagnostics: {
      ...req.diagBase,
      textLength: fallbackText.length,
      spokenLength: fallbackSpoken?.length ?? 0,
    },
  }
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
  const req = prepareFreeAnswerRequest(question, history, items, subjectDetails, delta, prepItems, siteName, extra)

  try {
    const provider = getAIProvider()
    const result = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${question}\n\nContexte :\n${req.contextJson}`,
      responseSchema: req.answerSchema,
      geminiSchema: FREE_ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: req.maxOutputTokens,
    })
    const finalized = finalizeParsedResult(result, req)
    if (finalized) return finalized
  } catch (err) {
    console.error('[copilot-free] provider error:', err instanceof Error ? err.message : String(err))
  }

  return buildDeterministicFallback(items, subjectDetails, delta, prepItems, req)
}

// Détecte la fin du champ "spokenText" dans le JSON en cours de streaming.
// Sûr par construction : la génération JSON de Gemini est strictement
// séquentielle (jamais de réécriture d'un token déjà émis), donc un guillemet
// fermant suivi de `,` ou `}` marque bien la fin du champ, pas un guillemet
// interne (les guillemets internes sont échappés, capturés par l'alternative
// `\\.` du groupe). Motif prouvé par `_audit-ordre-spoken.ts`.
const SPOKEN_FIELD_RE = /"spokenText"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]/

/**
 * D1 (2026-08-16) — même pipeline que `answerCopilotFreeQuestion`, transport
 * streamé : appelle `handlers.onSpokenReady` dès que `spokenText` est complet
 * ET conforme au contrat D0 (`isSpokenTextWithinPlanVoix`), pour lancer la
 * synthèse vocale avant la fin de la réponse écrite. Ne raccourcit ni ne
 * modifie le texte final : `finalizeParsedResult`/`buildDeterministicFallback`
 * sont partagés à l'identique avec le chemin non streamé.
 *
 * Se replie silencieusement sur `answerCopilotFreeQuestion` si le provider
 * actif n'implémente pas `completeStream` (mock, anthropic) — aucune panne,
 * juste pas de gain de latence orale.
 */
export async function answerCopilotFreeQuestionStream(
  question: string,
  history: HistoryMessage[],
  items: CopilotItem[],
  subjectDetails: SubjectDetailContext[],
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
  siteName: string,
  extra?: FreeAnswerContext,
  handlers?: { onSpokenReady?: (spokenText: string) => void },
): Promise<FreeAnswer> {
  const provider = getAIProvider()
  if (!provider.completeStream) {
    return answerCopilotFreeQuestion(question, history, items, subjectDetails, delta, prepItems, siteName, extra)
  }

  const req = prepareFreeAnswerRequest(question, history, items, subjectDetails, delta, prepItems, siteName, extra)
  const controls = extra?.visitPlanDetail ?? []

  // Audit D1 (16/08) : gain théorique non confirmé terrain — ces jalons isolent
  // où il disparaît entre l'appel Gemini et l'événement SSE `spoken`. Fermé par
  // défaut (`COPILOT_DIAG=1`), même convention que `[copilot-diag]`.
  const diagEnabled = process.env.COPILOT_DIAG === '1'
  const diagLog = (stage: string, extra2: Record<string, unknown> = {}) => {
    if (!diagEnabled) return
    console.log('[copilot-stream-diag]', JSON.stringify({ stage, t: Date.now(), q: question.slice(0, 40), ...extra2 }))
  }

  try {
    diagLog('gemini_call_start')
    const gen = provider.completeStream({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `${question}\n\nContexte :\n${req.contextJson}`,
      responseSchema: req.answerSchema,
      geminiSchema: FREE_ANSWER_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: req.maxOutputTokens,
    })

    let acc = ''
    let spokenAnnounced = false
    let firstChunkSeen = false
    let spokenFieldStartSeen = false
    let step = await gen.next()
    while (!step.done) {
      if (!firstChunkSeen) {
        firstChunkSeen = true
        diagLog('first_chunk')
      }
      acc += step.value
      if (!spokenFieldStartSeen && acc.includes('"spokenText"')) {
        spokenFieldStartSeen = true
        diagLog('spoken_field_start')
      }
      if (!spokenAnnounced) {
        const m = SPOKEN_FIELD_RE.exec(acc)
        if (m) {
          spokenAnnounced = true
          diagLog('spoken_field_complete')
          try {
            const candidateRaw = JSON.parse(`"${m[1]}"`) as string
            const candidate = sanitizeSpokenText(candidateRaw)
            if (candidate && isSpokenTextWithinPlanVoix(candidate, controls)) {
              handlers?.onSpokenReady?.(candidate)
              diagLog('spoken_handler_invoked')
            } else {
              diagLog('spoken_rejected_plan_voix')
            }
          } catch {
            // JSON invalide en cours de flux (échappement partiel) : on
            // n'annonce rien, la réponse écrite complète reste le contrat.
          }
        }
      }
      step = await gen.next()
    }
    diagLog('full_text_complete')

    const finalized = finalizeParsedResult(step.value, req)
    if (finalized) return finalized
  } catch (err) {
    console.error('[copilot-free] provider stream error:', err instanceof Error ? err.message : String(err))
  }

  return buildDeterministicFallback(items, subjectDetails, delta, prepItems, req)
}
