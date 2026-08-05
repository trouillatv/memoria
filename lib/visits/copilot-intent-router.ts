// Intent Router V2 — routeur centralisé déterministe pour le Copilote.
// Aucune logique Supabase. Aucune écriture DB.
//
// Pipeline : texte → normalisation → signaux métier → intent fermé + confiance + signaux.
//
// Règles d'architecture :
//   — Le routeur représente les capacités RÉELLES de MemorIA, pas les futures.
//   — CREATE_RESERVE / CREATE_DEADLINE / CREATE_WATCHPOINT existent dans le type
//     mais ne sont jamais détectés tant que leur pipeline n'est pas implémenté.
//   — UNKNOWN_WRITE remplace le LLM pour tout verbe d'écriture non résolu.
//   — Même routeur pour le texte et pour la voix (speech-to-text → même entrée).

export type WritingIntent =
  | 'READ'
  | 'CREATE_ACTION'
  | 'ADD_VISIT_ITEM'
  | 'SCHEDULE_VISIT'
  | 'SCHEDULE_MEETING'
  | 'UNKNOWN_WRITE'
  // Réservés — pipeline brouillon→confirmation→écriture non implémenté
  | 'CREATE_RESERVE'
  | 'CREATE_DEADLINE'
  | 'CREATE_WATCHPOINT'

export type IntentConfidence = 'strong' | 'ambiguous'

export type IntentResult = {
  intent: WritingIntent
  confidence: IntentConfidence
  signals: string[]
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Normalisation légère en trois temps :
 *   1. Casse + accents (é→e, à→a…)
 *   2. Apostrophes + tirets + ponctuation → espaces
 *   3. Espaces multiples → espace unique
 *
 * Pas de lemmatisation. Les signaux opèrent sur des tiges larges.
 */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // All apostrophe variants (U+0027 ASCII, U+2018/U+2019 curly, U+0060 backtick) → space
    .replace(/['‘’`]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Signaux de lecture ────────────────────────────────────────────────────────

// Questions ou demandes d'information explicites
const READ_RE = /\b(?:ou\s+en\s+(?:est|sont)|qu\s*en\s+est[-\s]?il|comment\s+(?:va|s|ca)|parle[rz]?[-\s]?(?:moi|nous)|raconte[rz]?[-\s]?(?:moi|nous)|dis[-\s]?(?:moi|nous)|infos?\s+sur|etat\s+(?:de|du|des)|situation|resume|synthese|quand\s+est|qui\s+s\s*occupe|combien|pourquoi|qu\s*est[-\s]ce|montre[rz]?[-\s]?(?:moi|nous)|presente[rz]?[-\s]?(?:moi|nous)|explique[rz]?)\b/

// ── Signaux métier ────────────────────────────────────────────────────────────

// "prochaine visite", "plan de visite", "au plan", "mon plan"
const NEXT_VISIT_RE = /\b(?:prochaine\s+visite|plan\s+(?:de\s+(?:la\s+)?)?visite|au\s+plan\b|en\s+plan\b|(?:mon|le|ce|ton)\s+plan\b|prochain\s+passage|prochaine\s+fois|quand\s+(?:je\s+|j?\s*)?irai|a\s+la\s+(?:prochaine\s+)?visite)\b/

const VISIT_RE    = /\bvisite\b/
const MEETING_RE  = /\breunion\b/
const ACTION_RE   = /\b(?:action|tache)\b/

// Expressions temporelles — jours, mois, heures, dates relatives
const DATETIME_RE = /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apres\s*demain|aujourd\s*hui|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|ce\s+(?:soir|matin|midi)|\d{1,2}[h:]\d{0,2}|\d{1,2}\s+(?:heures?|h)\b|\d{1,2}\/\d{1,2})\b/

// Familles de verbes de planification (tiges larges)
// prevois = 2ème personne impératif ("Prévois une visite") — exclut prevoit (3ème pers., descriptif)
const SCHEDULE_VERB_RE = /\b(?:planifi|programm|organis|prevois|inscri|marqu|convoque)\w*\b/

// Verbes de création générique (cree/creer) ou déterminant de nouveauté (nouveau/nouvelle).
// Utilisé UNIQUEMENT en combinaison avec hasVisit pour SCHEDULE_VISIT sans temporalité.
// N'inclut pas "démarrer/commencer" (lancement opérationnel, pas planification).
const CREATE_VISIT_RE = /\bcree\w*\b|\bnouve(?:aux?|ll?e[sx]?)\b/

// Verbes d'écriture forts — intention de commande claire
// "faut" seul (il faut) est un signal fort ; "faudrait" (conditionnel) est faible.
// note\w* : impératif "note" et infinitif "noter" (noter\w* ne capturait pas l'impératif).
const STRONG_WRITE_RE = /\b(?:(?:ajout|rajoute|cree|note|notons|mets|mettr|fai[st]|ouvr|declenche|genere|rappell?)\w*|faut)\b/

// Verbes d'écriture implicites — besoin exprimé sans commande directe
const WEAK_WRITE_RE = /\b(?:faudr|il\s+faut\s|pens[eo][rz]?\s+a|gard[ea]\b|conserv|checker|controler|verifi)\w*/

// Objets non encore supportés — déclenchent UNKNOWN_WRITE plutôt que CREATE_ACTION
const UNSUPPORTED_RE = /\b(?:reserve|echeance|point\s+de\s+vigilance|alerte|signalement|litige|non[-\s]?conformite)\b/

// ── Détection ─────────────────────────────────────────────────────────────────

export function detectIntent(question: string): IntentResult {
  const q = normalizeQuery(question)
  const signals: string[] = []

  const isRead         = READ_RE.test(q)
  const hasNextVisit   = NEXT_VISIT_RE.test(q)
  const hasVisit       = VISIT_RE.test(q)
  const hasMeeting     = MEETING_RE.test(q)
  const hasAction      = ACTION_RE.test(q)
  const hasDatetime    = DATETIME_RE.test(q)
  const hasSchedVerb   = SCHEDULE_VERB_RE.test(q)
  const hasStrongWrite  = STRONG_WRITE_RE.test(q)
  const hasWeakWrite    = WEAK_WRITE_RE.test(q)
  const hasUnsupported  = UNSUPPORTED_RE.test(q)
  const hasCreateVisit  = hasVisit && CREATE_VISIT_RE.test(q)
  const isWrite         = hasStrongWrite || hasSchedVerb

  if (isRead)                            signals.push('read_signal')
  if (hasNextVisit)                      signals.push('next_visit')
  if (hasVisit && !hasNextVisit)         signals.push('visit')
  if (hasMeeting)                        signals.push('meeting')
  if (hasAction)                         signals.push('action')
  if (hasDatetime)                       signals.push('future_datetime')
  if (hasSchedVerb)                      signals.push('schedule_verb')
  if (hasCreateVisit)                    signals.push('create_visit')
  if (hasStrongWrite && !hasSchedVerb)   signals.push('write_verb')
  if (hasWeakWrite)                      signals.push('implicit_write')
  if (hasUnsupported)                    signals.push('unsupported_object')

  // ── Garde READ ────────────────────────────────────────────────────────────
  // Lecture explicite sans verbe d'écriture → READ
  // Priorité absolue : un faux positif d'écriture est plus grave qu'une commande non reconnue.
  if (isRead && !isWrite && !hasWeakWrite) {
    return { intent: 'READ', confidence: 'strong', signals }
  }
  if (isRead && !isWrite) {
    // Signal de lecture + verbe implicite (ex. "quand est ma prochaine visite ?") → READ
    return { intent: 'READ', confidence: 'ambiguous', signals }
  }

  // ── Priorité 1 : ADD_VISIT_ITEM ──────────────────────────────────────────
  // "prochaine visite" / "plan de visite" domine le verbe, sauf si "action" est explicite.
  if (hasNextVisit && !hasAction) {
    const confidence: IntentConfidence = (isWrite || hasWeakWrite) ? 'strong' : 'ambiguous'
    return { intent: 'ADD_VISIT_ITEM', confidence, signals }
  }

  // ── Priorité 2 : SCHEDULE_VISIT ──────────────────────────────────────────
  // "visite" + verbe de planification OU temporalité OU verbe de création.
  // hasCreateVisit ("crée/nouvelle") = planification implicite sans date → ambiguous.
  // "démarrer/commencer" ≠ hasCreateVisit : lancement opérationnel, non couvert ici.
  if (hasVisit && !hasNextVisit && !hasAction && (hasSchedVerb || hasDatetime || hasCreateVisit)) {
    const confidence: IntentConfidence = hasSchedVerb ? 'strong' : 'ambiguous'
    return { intent: 'SCHEDULE_VISIT', confidence, signals }
  }

  // ── Priorité 3 : SCHEDULE_MEETING ────────────────────────────────────────
  if (hasMeeting && (hasSchedVerb || hasDatetime)) {
    const confidence: IntentConfidence = hasSchedVerb ? 'strong' : 'ambiguous'
    return { intent: 'SCHEDULE_MEETING', confidence, signals }
  }

  // ── Priorité 4 : CREATE_ACTION ───────────────────────────────────────────
  // Objet "action/tâche" explicite → toujours fort.
  // Verbe fort sans objet non supporté et sans visite/réunion → action par défaut.
  if (hasAction && (isWrite || hasWeakWrite)) {
    return { intent: 'CREATE_ACTION', confidence: 'strong', signals }
  }
  if (isWrite && !hasUnsupported && !hasVisit && !hasMeeting) {
    return { intent: 'CREATE_ACTION', confidence: 'ambiguous', signals }
  }

  // ── Priorité 5 : UNKNOWN_WRITE ───────────────────────────────────────────
  // Verbe d'écriture détecté mais intention non résolue ou objet non supporté.
  // → Réponse de clarification côté UI, jamais de LLM qui nie une capacité.
  if (isWrite || hasWeakWrite) {
    return { intent: 'UNKNOWN_WRITE', confidence: 'ambiguous', signals }
  }

  // ── Priorité 6 : READ (fallback) ─────────────────────────────────────────
  return { intent: 'READ', confidence: 'strong', signals }
}
