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
  /\boù en est\b/i,
  /\boù en sont\b/i,
  /\bqu.en est.il\b/i,
  /\bé[tv]at de\b/i,
  /\bparle.{0,5}moi\b/i,
  /\bhistoire\b/i,
  /\bévolution\b/i,
  /\bprogression\b/i,
  /\binfos? sur\b/i,
  /\bsituation\b/i,
  /\bpoint sur\b/i,
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
  /\bcr[eé]e[rsz]?\b/i,           // crée, crées, créer, créez
  /\bajoute[rsz]?\b/i,             // ajoute, ajoutes, ajouter, ajoutez
  /\bplanifie[rsz]?\b/i,           // planifie, planifies, planifier, planifiez
  /\bmets?\s+en\s+plan\b/i,
  /\bprogramme[rsz]?\b/i,          // programme, programmes, programmer, programmez
  /\borganise[rsz]?\b/i,           // organise, organises, organiser, organisez
  /\bnote[rsz]?\b/i,               // note, notes, noter, notez
  /\brappe?l\b/i,
  /\bpr[eé]vois?\b/i,              // prévois, prévoit
  /\bpose[rsz]?\s+(?:une?\s+)?(?:visite|r[eé]union|rdv|rendez-vous)\b/i,
  /\bfixe[rsz]?\s+(?:une?\s+)?(?:visite|r[eé]union|date|rdv|rendez-vous)\b/i,
]

// ── Extraction d'entités ───────────────────────────────────────────────────────

// Pattern horaire : 9H, 09H, 9H30, 14H00, etc. — jamais un code de sujet.
const TIME_CODE_RE = /^\d{1,2}[hH]\d{0,2}$/

/**
 * Extrait les codes techniques détectables dans la question.
 * Complète extractTechnicalCodes avec les références entre guillemets.
 * Les expressions horaires (9H, 14H30…) sont explicitement exclues.
 */
function extractSubjectLabels(question: string): string[] {
  const labels = new Set<string>()

  // Codes techniques (G3, R4, DN160…) — sauf patterns horaires
  for (const code of extractTechnicalCodes(question)) {
    if (!TIME_CODE_RE.test(code)) labels.add(code)
  }

  // Références entre guillemets droits ou typographiques
  const quoted = question.match(/["""«]([^"""»]{2,60})["""»]/g) ?? []
  for (const q of quoted) {
    labels.add(q.replace(/^["""«]|["""»]$/g, '').trim())
  }

  return [...labels]
}

// Préfixes interrogatifs à supprimer pour isoler le syntagme sujet
const QUESTION_PREFIXES = [
  /^où en est[\s'l]+/i,
  /^où en sont[\s'l]+/i,
  /^qu.en est.il de[\s'l]+/i,
  /^qu.en est[\s'l]+/i,
  /^quel est l.état de[\s'l]+/i,
  /^quelle est la situation de[\s'l]+/i,
  /^comment va[\s'l]+/i,
  /^parle.moi de[\s'l]+/i,
  /^point sur[\s'l]+/i,
  /^infos? sur[\s'l]+/i,
  /^dis.moi[\s'l]+/i,
]

/**
 * Tente d'extraire un syntagme nominal sujet en supprimant les préfixes
 * interrogatifs courants. Retourne null si aucun préfixe connu n'est trouvé.
 * Utilisé comme fallback quand aucun code technique n'est extrait.
 */
export function extractQuestionSubjectPhrase(question: string): string | null {
  const q = question.trim().replace(/\s*[?!.]+\s*$/, '')
  for (const prefix of QUESTION_PREFIXES) {
    if (prefix.test(q)) {
      const stripped = q.replace(prefix, '').replace(/^(le|la|les|l.)\s+/i, '').trim()
      if (stripped.length >= 4) return stripped
    }
  }
  return null
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
