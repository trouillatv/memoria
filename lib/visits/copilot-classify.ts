// Classification d'intention pour le Copilote Phase 3 — conversation libre.
//
// Déterministe, pas de LLM. Retourne une classification multi-intents.
// Le chargement des read-models reste paresseux : seuls les modules
// nécessaires à l'intent primaire (+ secondaires) sont chargés.

import { extractTechnicalCodes } from '@/lib/documents/semantic-subject-resolution'

export type IntentFamily =
  | 'subject_detail'  // question sur un sujet nommé (G3, R4…)
  | 'timeline'        // question sur une période ou des changements récents
  | 'action_status'   // question sur les actions, travaux, engagements
  | 'actor'           // question sur une personne ou entreprise
  | 'plan_visite'     // question sur la prochaine visite ou le plan actif
  | 'global'          // résumé général, état du chantier
  | 'proposal_request' // intention d'écriture (crée, ajoute, planifie…)

export type IntentClassification = {
  primary: IntentFamily
  secondary: IntentFamily[]
  entities: {
    /** Codes techniques ou labels extraits de la question (G3, R4, DN160…) */
    subjectLabels: string[]
    /** Noms propres potentiels (simple heuristique — affiné en 3B) */
    actorLabels: string[]
  }
  isWriteRequest: boolean
}

// ── Signaux ───────────────────────────────────────────────────────────────────

const SUBJECT_SIGNALS = [
  /\bpourquoi\b/i,
  /\bcomment\b/i,
  /\bcombien de fois\b/i,
  /\brevient\b/i,
  /\bdepuis quand\b/i,
  /\ben est où\b/i,
  /\bé[tv]at de\b/i,
  /\bparle.{0,5}moi\b/i,
  /\bhistoire\b/i,
  /\bévolution\b/i,
  /\bprogression\b/i,
]

const TIMELINE_SIGNALS = [
  /\bderni[eè]re[s]?\s+(semaine|quinzaine|visite|pv)\b/i,
  /\bdepuis\b/i,
  /\bentre\b/i,
  /\ba\s+chang[eé]\b/i,
  /\br[eé]cemment\b/i,
  /\bnouveaut[eé]\b/i,
  /\bdelta\b/i,
  /\bpv\s+\d+\b/i,
]

const ACTION_SIGNALS = [
  /\baction[s]?\b/i,
  /\btravaux\b/i,
  /\bréalis[eé]\b/i,
  /\bre?tards?\b/i,
  /\bplanifi[eé]\b/i,
  /\bengagem[eé]nt\b/i,
  /\bsuivi\b/i,
  /\bbloq[uü][eé]\b/i,
]

const ACTOR_SIGNALS = [
  /\bresponsable\b/i,
  /\bqui s'occupe\b/i,
  /\bentreprise\b/i,
  /\bcontact\b/i,
  /\bintervenant\b/i,
  /\bcharg[eé]\b/i,
]

const PLAN_SIGNALS = [
  /\bpr[eé]parer\b/i,
  /\bprochaine\s+visite\b/i,
  /\bv[eé]rifier\b/i,
  /\bplan\s+(de\s+)?visite\b/i,
  /\bpoint[s]?\s+[àa]\s+voir\b/i,
]

const PROPOSAL_SIGNALS = [
  /\bcr[eé]e[rz]?\b/i,
  /\bajoute[rz]?\b/i,
  /\bplanifie[rz]?\b/i,
  /\bmets?\s+en\s+plan\b/i,
  /\bprogramme[rz]?\b/i,
  /\bnote[rz]?\b/i,
  /\brappe?l\b/i,
]

// ── Extraction d'entités ───────────────────────────────────────────────────────

/**
 * Extrait les codes techniques détectables dans la question.
 * Complète extractTechnicalCodes avec les références entre guillemets.
 */
function extractSubjectLabels(question: string): string[] {
  const labels = new Set<string>()

  // Codes techniques (G3, R4, DN160…)
  for (const code of extractTechnicalCodes(question)) {
    labels.add(code)
  }

  // Références entre guillemets droits ou typographiques
  const quoted = question.match(/["""«]([^"""»]{2,60})["""»]/g) ?? []
  for (const q of quoted) {
    labels.add(q.replace(/^["""«]|["""»]$/g, '').trim())
  }

  return [...labels]
}

/**
 * Heuristique simple pour détecter des noms propres (majuscule isolée, ≥ 3 chars).
 * Affinée en Lot 3B avec un matching réel contre stakeholders.
 */
function extractActorLabels(question: string): string[] {
  const words = question.split(/\s+/)
  const candidates: string[] = []
  for (const w of words) {
    const clean = w.replace(/[^a-zA-ZÀ-ÿ-]/g, '')
    if (clean.length >= 3 && /^[A-ZÀ-Ÿ]/.test(clean) && !/^(Qu|Que|Quoi|Pourquoi|Comment|Combien|Depuis|Lequel|La|Le|Les|De|Du|Des|Un|Une)$/i.test(clean)) {
      candidates.push(clean)
    }
  }
  return candidates
}

// ── Scoreur d'intent ──────────────────────────────────────────────────────────

function countSignals(question: string, signals: RegExp[]): number {
  return signals.filter((r) => r.test(question)).length
}

export function classifyIntent(question: string): IntentClassification {
  const subjectLabels = extractSubjectLabels(question)
  const actorLabels = extractActorLabels(question)

  // Vérification écriture en premier (ne crée pas une subject_detail si c'est un write)
  const isWriteRequest = countSignals(question, PROPOSAL_SIGNALS) >= 1

  // Score par famille (hors proposal)
  const scores: Record<Exclude<IntentFamily, 'proposal_request'>, number> = {
    subject_detail: (subjectLabels.length > 0 ? 2 : 0) + countSignals(question, SUBJECT_SIGNALS),
    timeline:       countSignals(question, TIMELINE_SIGNALS),
    action_status:  countSignals(question, ACTION_SIGNALS),
    actor:          countSignals(question, ACTOR_SIGNALS),
    plan_visite:    countSignals(question, PLAN_SIGNALS),
    global:         0,
  }

  if (isWriteRequest) {
    return {
      primary: 'proposal_request',
      secondary: [],
      entities: { subjectLabels, actorLabels },
      isWriteRequest: true,
    }
  }

  // Trier par score décroissant
  const sorted = (Object.entries(scores) as [Exclude<IntentFamily, 'proposal_request'>, number][])
    .sort(([, a], [, b]) => b - a)

  const primary = sorted[0][0]
  const secondary: IntentFamily[] = sorted
    .slice(1)
    .filter(([, score]) => score > 0)
    .map(([family]) => family)

  // Si aucun signal clair → global
  const resolvedPrimary: IntentFamily = sorted[0][1] === 0 ? 'global' : primary

  return {
    primary: resolvedPrimary,
    secondary,
    entities: { subjectLabels, actorLabels },
    isWriteRequest: false,
  }
}
