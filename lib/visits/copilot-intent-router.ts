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
  | 'OBSERVATION'
  | 'FACT'
  | 'CORRECTION_IDENTITY'
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

/**
 * Une lecture reste-t-elle plausible après le passage du routeur déterministe ?
 *
 * Sert uniquement à décider si le contexte chantier peut être chargé de façon
 * SPÉCULATIVE, avant la couche de compréhension. Ne décide d'aucune branche
 * métier : une mauvaise spéculation coûte des lectures inutiles, jamais un
 * résultat différent.
 *
 * Règle : une écriture `ambiguous` est précisément le cas où la compréhension
 * peut requalifier en lecture. L'audit du 16/08 l'a mesuré en production sur
 * « Quels sont les points de la réunion de demain à évoquer ? » →
 * SCHEDULE_MEETING/ambiguous, puis `read_downgrade` par la compréhension, et
 * 1729 ms d'attente de contexte au lieu de ~150. Une écriture `strong`, elle,
 * ne redescend jamais : on n'anticipe pas.
 */
export function readRemainsPlausible(result: IntentResult): boolean {
  return result.intent === 'READ' || result.confidence === 'ambiguous'
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
const READ_RE = /\b(?:ou\s+en\s+(?:est|sont)|qu\s*en\s+est[-\s]?il|comment\s+(?:va|s|ca)|parle[rz]?[-\s]?(?:moi|nous)|raconte[rz]?[-\s]?(?:moi|nous)|dis[-\s]?(?:moi|nous)|infos?\s+sur|etat\s+(?:de|du|des)|situation|resume|synthese|quand\s+est|qui\s+s\s*occupe|combien|pourquoi|qu\s*est[-\s]ce|montre[rz]?[-\s]?(?:moi|nous)|presente[rz]?[-\s]?(?:moi|nous)|explique[rz]?|dois[-\s]?je|je\s+dois)\b/

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
// Exclusion "qu il/on/elle faut" : "qu'est-ce qu'il faut que je regarde ?" est une
// question sur un besoin, pas une commande — le "faut" y est introduit par une
// relative interrogative, jamais une consigne à l'impératif (bug Copilote V2,
// retour Guillaume, phrase orale dégradée "euh... qu'est-ce qu'il faut que...").
const STRONG_WRITE_RE = /\b(?:(?:ajout|rajoute|cree|note|notons|mets|mettr|fai[st]|ouvr|declenche|genere|rappell?)\w*|(?<!qu\s(?:il|on|elle)\s)faut)\b/

// La tige fai[st] (dans STRONG_WRITE_RE) capture aussi bien « Fais une action »
// (commande) que « L'accès se fait par l'arrière » (constat descriptif à la
// forme réfléchie-passive) — cette 2ᵉ tournure n'est jamais une commande.
// Découvert sur l'audit P4-C (2026-08-17, phrase 5/8) : la phrase partait en
// CREATE_ACTION ambiguous au lieu de FACT. Aucun test existant ne s'appuie sur
// « fai[st] » précisément (vérifié par grep) — carve-out sans risque.
const REFLEXIVE_DESCRIPTIVE_RE = /\bse\s+fai[st]\w*\b/

// Verbes d'écriture implicites — besoin exprimé sans commande directe
const WEAK_WRITE_RE = /\b(?:faudr|il\s+faut\s|pens[eo][rz]?\s+a|gard[ea]\b|conserv|checker|controler|verifi)\w*/

// Objets non encore supportés — déclenchent UNKNOWN_WRITE plutôt que CREATE_ACTION
const UNSUPPORTED_RE = /\b(?:reserve|echeance|point\s+de\s+vigilance|alerte|signalement|litige|non[-\s]?conformite)\b/

// ── Signaux OBSERVATION ────────────────────────────────────────────────────────
//
// Un constat factuel sur l'état réel du chantier : « Le cadenas n'est toujours
// pas installé », « Les gaines sont arrivées ce matin ». Les deux signaux sont
// exigés ENSEMBLE — l'être-verbe seul est omniprésent (trop de faux positifs),
// un marqueur temporel seul sert déjà DATETIME_RE pour la planification.
//
// Ne code aucune notion d'évolution : une occurrence peut confirmer un état
// inchangé, la décision "évolution ou pas" se prend après matérialisation
// (doctrine Fact Ledger), jamais dans le routeur.
const OBSERVATION_STATE_RE  = /\b(?:est|sont|etait|etaient|reste[nt]?|demeure[nt]?)\b/
const OBSERVATION_MARKER_RE = /\b(?:toujours\s+pas|encore|deja|desormais|enfin|maintenant|ce\s+matin|ce\s+soir|aujourd\s*hui|hier|depuis\s+(?:ce\s+matin|hier|peu))\b/

// Exclut l'engagement futur : « sera installé vendredi » n'est pas un constat.
const FUTURE_TENSE_RE = /\b(?:sera|seront|serai|seras|va\s+(?:etre|venir|arriver)|vont\s+(?:etre|venir|arriver)|devrait\s+etre)\b/

// Exclut l'opinion : « je pense que X est responsable » n'est pas un constat terrain.
const OPINION_RE = /\b(?:je\s+pense\s+que|je\s+crois\s+que|j\s*estime\s+que|a\s+mon\s+avis)\b/

// ── Signaux FACT (P4-C, Vincent 2026-08-17) ───────────────────────────────────
//
// Une information déclarative à retenir qui n'est ni une question, ni une
// action demandée, ni un constat d'état terrain (OBSERVATION), ni une
// correction d'identité, ni une relation structurée (RELATION_CLAIM, futur
// P4-B.3), ni une planification. Exemples de l'audit : « Jérôme passe demain
// matin. », « Vincent Milon est l'interlocuteur principal sur ce dossier. »,
// « Le code du portail est 4812. » — 5 des 8 phrases de l'audit tombaient en
// READ fallback (perte pure), 2 étaient absorbées par SCHEDULE_MEETING ou
// CREATE_ACTION en ambiguous, 1 restait UNKNOWN_WRITE non exploitée.
//
// Recouvrement DÉLIBÉRÉ avec OBSERVATION_STATE_RE (est/sont) et FUTURE_TENSE_RE
// (sera/seront) : FACT doit justement capturer les faits au futur que
// OBSERVATION exclut explicitement (« Le chantier sera fermé vendredi
// après-midi. »). La frontière avec OBSERVATION se fait par exclusion : si la
// condition OBSERVATION serait vraie (état + marqueur de continuité, sans
// futur ni opinion), FACT s'efface — l'inverse ferait perdre un constat
// terrain daté au profit d'une simple information générique.
const FACT_ASSERTION_RE =
  /\b(?:est|sont|etait|etaient|sera|seront|a\s+prevu|ont\s+prevu|passe|passent|se\s+fait|se\s+font)\b/

// « Le client veut conserver cette porte. » — souhait RAPPORTÉ (3ᵉ personne),
// pas une commande directe à MemorIA (contrairement à « Garde cette porte »,
// impératif 2ᵉ personne que WEAK_WRITE_RE capture par ailleurs). Ce signal
// prime sur l'exclusion générique des verbes d'écriture faibles.
const FACT_REPORTED_WISH_RE = /\b(?:veut|veulent|voudrait|voudraient|souhaite(?:nt)?)\b/

/**
 * Extrait le marqueur temporel littéral d'un FACT (jour/date/heure), pour
 * affichage uniquement (champ « temporalité » du brouillon) — jamais inventé,
 * jamais utilisé pour router. Retourne le texte normalisé, ou null si aucune
 * temporalité n'est explicitement exprimée (doctrine anti-faits-fictifs).
 */
export function extractFactTemporality(question: string): string | null {
  const q = normalizeQuery(question)
  const match = DATETIME_RE.exec(q)
  return match ? match[0] : null
}

// ── Signaux CORRECTION_IDENTITY (P4-B.2, Vincent 2026-08-17) ──────────────────
//
// Corrige une mécoupure STT ou une manière de désigner un acteur DÉJÀ CONNU
// (company/company_contact) : « Quand je dis Clim Expert, je parle de Clim
// Expair. » / « Non, Vincent Millon c'est Vincent Milon. » / « Jérôme, c'est
// Jérôme Martin de BECIB. » — jamais un fait ou une relation nouvelle
// (« Clim Expair s'occupe de la climatisation », « Jérôme travaille chez
// BECIB » = RELATION_CLAIM, futur P4-B.3). Ces 3 formes exigent toutes
// "je parle de" ou "c'est" — structurellement absent des exemples relationnels
// ci-dessus, donc aucune garde anti-collision supplémentaire n'est nécessaire.
//
// Détection uniquement ICI (booléen, texte normalisé) — l'extraction du
// contenu structuré (alias/cible/nature) opère sur le texte ORIGINAL et vit
// dans lib/visits/copilot-identity-correction.ts (normalizeQuery supprime les
// virgules, ce qui casserait la lecture "X, c'est Y de Z").
const IDENTITY_CORRECTION_QUAND_RE = /\bquand\s+je\s+dis\s+.+\s+je\s+parle\s+de\s+.+/
const IDENTITY_CORRECTION_NON_RE   = /^non\s+.+\s+c\s+est\s+.+/
const IDENTITY_CORRECTION_DE_RE    = /\bc\s+est\s+.+\s+de\s+.+/
// "On appelle aussi X, Y" (texte normalisé) — ancre "on appelle aussi" rare
// et non ambiguë, aucune garde supplémentaire nécessaire.
const IDENTITY_CORRECTION_ON_APPELLE_RE = /\bon\s+appelle\s+aussi\b/
// "X, c'est Y" nue (Vincent, 2026-08-17) — sans "non"/"de", structure trop
// commune en français pour être détectée sur le seul mot "c'est" (cf.
// hasIdentityCorrection → CORRECTION_IDENTITY strong, qui prime sur TOUT,
// y compris READ/OBSERVATION). Gardée par une heuristique nom-propre : le
// segment avant la virgule doit être 1 à 4 mots CONSÉCUTIFS capitalisés,
// testés sur le texte ORIGINAL (la casse disparaît dans `q`). Le français ne
// capitalise que le début de phrase et les noms propres : "Le plan, c'est…"
// a un 2ᵉ mot en minuscule et ne matche pas ; "Clim Expair, c'est…" matche.
const IDENTITY_CORRECTION_BARE_CEST_RE =
  /^[A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]*){0,3}\s*,\s*c['’`]?\s?est\s+.+/

/**
 * Extrait le marqueur temporel littéral d'un constat OBSERVATION, pour affichage
 * uniquement (champ « temporalité » du brouillon) — ne participe à aucun routage.
 * Retourne le texte normalisé (sans accents), pas le texte source original.
 */
export function extractObservationMarker(question: string): string | null {
  const q = normalizeQuery(question)
  const match = OBSERVATION_MARKER_RE.exec(q)
  return match ? match[0] : null
}

// ── Demande de PRÉPARATION de visite ──────────────────────────────────────────
//
// « Fais-moi les points de contrôle pour ma prochaine visite » demande à MemorIA
// de PRODUIRE le plan. Le routeur y voyait un ordre d'écriture — "fais" est un
// verbe fort, "prochaine visite" domine — et retournait ADD_VISIT_ITEM *strong*,
// c'est-à-dire une proposition de créer un point de visite intitulé... la phrase
// de l'utilisateur (recette PETRO, 2026-08-15). La couche de compréhension ne
// pouvait pas rattraper : `mergeComprehension` ne rétrograde jamais un `strong`.
//
// D'où une garde DÉTERMINISTE, avant toute autre règle : la fonction essentielle
// « prépare ma visite » ne doit pas dépendre d'un appel LLM.
//
// Frontière avec ADD_VISIT_ITEM : une demande de préparation ne nomme AUCUN objet
// à inscrire, elle nomme le plan lui-même. « Ajoute l'accès sécurisé aux points à
// vérifier » apporte un contenu → reste une écriture.

/** Verbes de PRODUCTION d'une liste. Ni "planifie" ni "ajoute" : ceux-là écrivent. */
const PLAN_GEN_VERB = String.raw`(?:prepar|fai[st]|donn|list|gener|etabli|sors|montr)\w*`

/** Déterminants tolérés entre le verbe et l'objet — liste fermée, jamais "de"/"du". */
const PLAN_FILLER = String.raw`(?:(?:moi|nous|me|le|la|les|un|une|mon|ma|mes|ton|tous|toutes)\s+){0,3}`

/** L'objet « le plan lui-même » — jamais un sujet de chantier. */
const PLAN_OBJECT = String.raw`(?:points?\s+de\s+controle|check\s?list|plan\s+de\s+(?:la\s+)?visite|(?:prochaine\s+)?visite|prochain\s+passage)`

/** Verbes de constat terrain, utilisés en tournure interrogative. */
const CHECK_VERB = String.raw`(?:verifi|surveill|control|regard|inspect|check)\w*`

const VISIT_PREP_REQUEST_RE = new RegExp([
  // « prépare-moi ma visite », « fais-moi les points de contrôle »
  String.raw`\b${PLAN_GEN_VERB}\s+${PLAN_FILLER}${PLAN_OBJECT}\b`,
  // « qu'est-ce que je dois vérifier », « que dois-je regarder en priorité »
  String.raw`\b(?:je\s+dois|dois\s+je)\s+(?:\w+\s+){0,2}?${CHECK_VERB}`,
  // « je vérifie quoi ? »
  String.raw`\bje\s+${CHECK_VERB}\s+quoi\b`,
  // « que vérifier sur place ? »
  String.raw`\b(?:quoi|que)\s+${CHECK_VERB}`,
  // « à quoi faire attention ? », « sur quoi me concentrer ? »
  String.raw`\b(?:a|sur)\s+quoi\s+(?:\w+\s+){0,3}?(?:attention|concentrer|focaliser)`,
].join('|'))

/**
 * Verbes d'INSERTION d'un objet. Leur présence rend la phrase écrivante quoi
 * qu'elle contienne par ailleurs : « Ajoute une action pour préparer la prochaine
 * visite » nomme un objet à créer, le « préparer » n'y est qu'une finalité.
 * Ils ne recouvrent jamais PLAN_GEN_VERB — un verbe ne peut pas être les deux.
 */
const PLAN_WRITE_BLOCKER_RE = /\b(?:ajout|rajout|met[st]|mettre|not[ei]|inscri|cree?|creer|planifi|programm|enregistr)\w*/

/**
 * La question demande-t-elle à MemorIA de PRODUIRE un plan de visite ?
 *
 * Exportée pour que le routeur et la classification métier partagent une seule
 * définition : une formulation reconnue ici doit toujours produire le couple
 * `intent=READ` + `primary=plan_visite`, sans quoi le plan serait bien routé mais
 * jamais construit (`safeIntent` ≠ `next_visit`).
 */
export function isVisitPrepRequest(question: string): boolean {
  const q = normalizeQuery(question)
  if (PLAN_WRITE_BLOCKER_RE.test(q)) return false
  return VISIT_PREP_REQUEST_RE.test(q)
}

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
  const hasStrongWrite  = STRONG_WRITE_RE.test(q) && !REFLEXIVE_DESCRIPTIVE_RE.test(q)
  const hasWeakWrite    = WEAK_WRITE_RE.test(q)
  const hasUnsupported  = UNSUPPORTED_RE.test(q)
  const hasCreateVisit  = hasVisit && CREATE_VISIT_RE.test(q)
  const isWrite         = hasStrongWrite || hasSchedVerb
  const hasObsState     = OBSERVATION_STATE_RE.test(q)
  const hasObsMarker    = OBSERVATION_MARKER_RE.test(q)
  const hasFutureTense  = FUTURE_TENSE_RE.test(q)
  const hasOpinion      = OPINION_RE.test(q)
  const hasFactAssertion = FACT_ASSERTION_RE.test(q)
  const hasReportedWish  = FACT_REPORTED_WISH_RE.test(q)
  const hasQuestionMark  = /\?\s*$/.test(question.trim())
  const hasIdentityCorrection =
    IDENTITY_CORRECTION_QUAND_RE.test(q) ||
    IDENTITY_CORRECTION_NON_RE.test(q) ||
    IDENTITY_CORRECTION_DE_RE.test(q) ||
    IDENTITY_CORRECTION_ON_APPELLE_RE.test(q) ||
    IDENTITY_CORRECTION_BARE_CEST_RE.test(question.trim())

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
  if (hasFactAssertion)                  signals.push('fact_assertion')
  if (hasReportedWish)                   signals.push('reported_wish')

  // ── Garde PRÉPARATION DE VISITE ───────────────────────────────────────────
  // Prime sur tout : « fais-moi les points de contrôle pour ma prochaine visite »
  // demande de PRODUIRE le plan, pas d'y inscrire une ligne. Sans cette garde,
  // Priorité 1 rendait ADD_VISIT_ITEM *strong* — que la compréhension LLM ne peut
  // pas rétrograder — et MemorIA créait un point de visite intitulé avec la
  // question elle-même (recette PETRO, 2026-08-15).
  if (isVisitPrepRequest(question)) {
    return { intent: 'READ', confidence: 'strong', signals: [...signals, 'visit_prep_request'] }
  }

  // ── Garde CORRECTION_IDENTITY ─────────────────────────────────────────────
  // Forme reconnue explicite ("je parle de" / "c'est") → prime sur READ/écriture
  // générique : ces phrases ne portent aucun verbe de lecture ni d'action, elles
  // seraient sinon perdues en fallback READ (cf. commentaire des signaux).
  if (hasIdentityCorrection) {
    return { intent: 'CORRECTION_IDENTITY', confidence: 'strong', signals: [...signals, 'identity_correction'] }
  }

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

  // ── Priorité 2bis : FACT ──────────────────────────────────────────────────
  // Information déclarative à retenir (P4-C). Exclusions explicites contre les
  // 6 catégories du cadrage Vincent :
  //   — question           → hasQuestionMark (le guard READ ne couvre pas les
  //                          interrogatives sans mot-clé, ex. "Quels sont…?")
  //   — action demandée    → hasStrongWrite / hasAction / hasSchedVerb
  //   — observation        → looksLikeObservation (miroir exact de la
  //                          condition Priorité 4bis : si OBSERVATION la
  //                          prendrait, FACT s'efface)
  //   — correction d'identité → déjà tranché par la garde CORRECTION_IDENTITY
  //                          plus haut, jamais atteint ici
  //   — relation structurée (RELATION_CLAIM, futur P4-B.3) → aucune exclusion
  //                          dédiée : les verbes relationnels (s'occupe de,
  //                          travaille chez, dépend de) ne déclenchent jamais
  //                          FACT_ASSERTION_RE, par construction
  //   — planification      → hasSchedVerb (SCHEDULE_VISIT/SCHEDULE_MEETING à
  //                          verbe explicite priment déjà, Priorité 1/2)
  // hasWeakWrite est toléré UNIQUEMENT si porté par un souhait rapporté
  // (« Le client veut conserver cette porte. ») — sinon il reste un signal
  // d'écriture implicite (UNKNOWN_WRITE, Priorité 5).
  const looksLikeObservation = hasObsState && hasObsMarker && !hasFutureTense && !hasOpinion
  if (
    (hasFactAssertion || hasReportedWish) &&
    !hasQuestionMark &&
    !hasStrongWrite &&
    !hasSchedVerb &&
    !hasAction &&
    !hasUnsupported &&
    !hasOpinion &&
    !looksLikeObservation &&
    (!hasWeakWrite || hasReportedWish)
  ) {
    return { intent: 'FACT', confidence: 'ambiguous', signals }
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

  // ── Priorité 4bis : OBSERVATION ──────────────────────────────────────────
  // Constat factuel (être-verbe + marqueur de continuité/temporalité), sans
  // verbe d'écriture ni demande de lecture explicite. Jamais de promotion en
  // "évolution" ici — voir le commentaire au-dessus de OBSERVATION_STATE_RE.
  if (
    !isWrite && !hasWeakWrite && !hasUnsupported &&
    hasObsState && hasObsMarker && !hasFutureTense && !hasOpinion
  ) {
    signals.push('observation_state')
    return { intent: 'OBSERVATION', confidence: 'ambiguous', signals }
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
