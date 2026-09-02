// Lot E1 — Capture & séparation des AXES du verdict documentaire.
//
// PROBLÈME (audit E) : `statusAtDocumentDate` est un champ FOURRE-TOUT. Il empile
// plusieurs axes sémantiques incompatibles : conformité (conforme/non conforme),
// cycle de vie (réalisé/en cours/à faire), présence (présent/absent), rôle
// organisationnel (maître d'œuvre/AMO), catégorie thématique égarée (forecast),
// temporel (en retard). Le mapping historique les entonne dans un seul
// `document_status` où « non examiné » / « non applicable » deviennent
// `informational → resolved` : une ABSENCE DE PREUVE devient une FAUSSE preuve
// de résolution.
//
// E1 = capturer ce que le document a EXACTEMENT écrit (sans perte) ET le
// classer par AXE, en normalisant SEULEMENT ce qui est fiable. Une valeur
// inconnue ou ambiguë reste CONSERVÉE et NON INTERPRÉTÉE (normalized = null) —
// jamais forcée dans une catégorie.
//
// PÉRIMÈTRE STRICT :
//   · E1 ne PROJETTE PAS vers state_status (resolved/open/unknown) — c'est E2.
//   · E1 ne modifie AUCUNE occurrence historique — c'est E3 (backfill).
//   · E1 n'interprète PAS la présence des personnes (présent/absent…) — c'est F.
//   · E1 n'interprète PAS les rôles organisationnels (MOE/AMO…) — relations org.
//   Ces axes sont RECONNUS et ÉTIQUETÉS pour EMPÊCHER la couche verdict de les
//   absorber, mais leur normalisation reste hors E.
//
// Pas d'enum universel figé sur CAPSE : le contrat accepte des vocabulaires
// inconnus. La classification est CONTEXT-AWARE (famille de proposition,
// catégorie thématique, et — extensible — champ/colonne/type de document).

/** L'AXE sémantique auquel appartient le verdict brut. Séparer les axes est le
 *  cœur de E1 : un même mot peut relever d'axes différents selon le contexte. */
export type VerdictAxis =
  | 'compliance'   // conformité d'un contrôle : le sujet est-il conforme / vérifié ?
  | 'lifecycle'    // avancement d'une tâche/ouvrage : fait / en cours / à faire / ouvert
  | 'presence'     // présence d'une personne — HORS E (relève de F)
  | 'org_role'     // rôle organisationnel — HORS E (relations)
  | 'thematic'     // catégorie thématique égarée dans le champ statut
  | 'temporal'     // information temporelle (en retard) — conservée, non projetée
  | 'unknown'      // vocabulaire non reconnu ou code ambigu — CONSERVÉ, non interprété

/** Sens NORMALISÉ générique, indépendant du vocabulaire du document. `null` =
 *  « je conserve le brut mais je ne l'interprète pas ». Les valeurs de cycle de
 *  vie restent DISTINCTES de la conformité même si E2 pourra les projeter vers
 *  le même tri-state — E1 ne les confond pas. Cette liste peut s'étendre ; elle
 *  n'est PAS un contrat figé et n'est dérivée d'aucun corpus particulier. */
export type NormalizedVerdict =
  // — axe conformité —
  | 'compliant_positive'   // conforme, favorable, satisfaisant, validé, OK, RAS
  | 'compliant_negative'   // non conforme, NOK, refusé, insatisfaisant, défavorable
  | 'unverified'           // non vérifié, non examiné, non contrôlé, non testé (preuve absente)
  | 'pending_control'      // à vérifier, à contrôler, à confirmer, visa en cours, en attente
  | 'not_applicable'       // non applicable, N/A, sans objet, hors périmètre
  // — axe cycle de vie —
  | 'lifecycle_done'       // réalisé, fait, terminé, levé, corrigé, exécuté, posé, émis
  | 'lifecycle_in_progress'// en cours, partiel, démarré
  | 'lifecycle_planned'    // non démarré, à faire, prévu, planifié, à venir
  | 'lifecycle_open'       // ouvert, signalé, constaté, non soldé, non réalisé, à corriger

export type VerdictConfidence = 'high' | 'medium' | 'low'

/** Capture LOSSLESS + classification d'un verdict documentaire. */
export interface VerdictCapture {
  /** Le texte EXACT du document, jamais perdu (même si non interprété). */
  raw: string
  axis: VerdictAxis
  /** `null` = conservé mais non interprété (inconnu / ambigu / hors-E). */
  normalized: NormalizedVerdict | null
  confidence: VerdictConfidence
  /** Provenance de la normalisation. `rule` = déterministe (E1). */
  source: 'rule'
  /** Justification courte, auditable. */
  reason: string
}

/** Contexte de classification. Seuls `family` et `thematicCategory` sont
 *  disponibles à la capture aujourd'hui ; `field`/`documentType` sont prévus
 *  pour désambiguïser plus tard (ex. code « C » selon la colonne) — E1 ne les
 *  exige pas mais le contrat les accepte. */
export interface VerdictContext {
  family: string
  thematicCategory?: string | null
  field?: string | null
  documentType?: string | null
}

/** Familles porteuses d'un état de SUJET métier (les seules où un verdict de
 *  conformité/cycle de vie a du sens). person/company en sont EXCLUES. */
const STATE_BEARING = new Set(['knowledge_fact', 'reservation', 'action', 'observation', 'deadline', 'decision'])

const THEMATIC_TOKENS = new Set([
  'progress', 'test_control', 'forecast', 'safety_environment', 'resources',
  'administrative', 'weather', 'permanent_instruction', 'general_knowledge',
])

/** Codes intrinsèquement ambigus hors contexte de colonne/formulaire : une
 *  lettre seule, un chiffre seul, une couleur. On NE force PAS — on conserve. */
const AMBIGUOUS_CODE = /^(?:[a-e]|[0-9]|vert|verte|rouge|orange|jaune|gris|green|red|amber)$/i

/** Codes courts de conformité — génériques (conforme / non conforme), PAS un
 *  vocabulaire propre à un document. Ils ne sont JAMAIS résolus sur la seule
 *  chaîne : ils exigent un contexte de grille de conformité (cf.
 *  `isComplianceGrid`). Hors de ce contexte, ils restent ambigus → conservés. */
const COMPLIANCE_CODES: Record<string, NormalizedVerdict> = {
  c: 'compliant_positive',
  nc: 'compliant_negative',
}

/** Le contexte est-il une grille de conformité/contrôle suffisamment probante
 *  pour désambiguïser un code court ? Signal explicite = libellé de colonne/
 *  champ (`état`/`statut`/`conformité`/`contrôle`) ; à défaut, proxy générique =
 *  catégorie thématique `test_control` (essais/contrôles/conformité). Aucun de
 *  ces signaux n'est propre à un document particulier. */
function isComplianceGrid(ctx: VerdictContext): boolean {
  const f = (ctx.field ?? '').toLowerCase()
  return /[ée]tat|statut|conformit|contr[ôo]le/.test(f) || ctx.thematicCategory === 'test_control'
}

/** Ordre des tests : formes NÉGATIVES et « absence de preuve » AVANT les
 *  positives (« non conforme » avant « conforme », « non réalisé » avant
 *  « réalisé », « non démarré » avant « démarré »), sinon un sous-motif
 *  positif matcherait à tort. NOTE : on N'UTILISE PAS `\b` au contact d'un
 *  caractère accentué (é, à) — en JS `\w` exclut les accents, donc `\bà`
 *  ou `levé\b` échouent silencieusement. On délimite par espaces/début/fin
 *  ou on reste en sous-chaîne (les statuts sont des phrases courtes).
 *  Chaque entrée : [regex, axis, normalized, confidence, reason]. */
const RULES: Array<[RegExp, VerdictAxis, NormalizedVerdict, VerdictConfidence, string]> = [
  // — absence de preuve (doit précéder tout le reste) —
  [/non\s*(?:v[ée]rifi|examin|contr[ôo]l|test)/i, 'compliance', 'unverified', 'high', 'absence de vérification'],
  [/non\s*(?:renseign|document)/i, 'compliance', 'unverified', 'medium', 'non renseigné = preuve absente'],
  // — non applicable —
  [/non\s*applicable|\bn\.?\s*\/?\s*a\.?\b|sans\s*objet|hors\s*p[ée]rim/i, 'compliance', 'not_applicable', 'high', 'non applicable'],
  // — conformité négative —
  [/non\s*conform|refus|insatisfais|d[ée]favorable|\bnok\b|\bko\b/i, 'compliance', 'compliant_negative', 'high', 'conformité négative'],
  // — cycle de vie « pas fait » / « à corriger » → ouvert (avant « réalisé/corrigé ») —
  [/non\s*(?:r[ée]alis|fait|ex[ée]cut|sold|lev)|[àa]\s*corriger/i, 'lifecycle', 'lifecycle_open', 'high', 'cycle de vie : pas fait / à corriger = ouvert'],
  // — « non démarré » → planifié (avant « démarré » = en cours) —
  [/non\s*d[ée]marr/i, 'lifecycle', 'lifecycle_planned', 'high', 'cycle de vie : non démarré = planifié'],
  // — contrôle en attente —
  [/[àa]\s*(?:v[ée]rifi|contr[ôo]l|confirm)|visa\s*en\s*cours|en\s*attente|attente\s*de\s*validation|en\s*cours\s*de\s*validation/i, 'compliance', 'pending_control', 'high', 'contrôle/validation en attente'],
  // — conformité positive —
  [/conforme|favorable|satisfais|valid[ée]|\bok\b|\bras\b|rien\s*[àa]\s*signaler|acceptable/i, 'compliance', 'compliant_positive', 'high', 'conformité positive'],
  // — cycle de vie —
  [/quasi\s*achev|en\s*cours|partiel|d[ée]marr|in\s*progress/i, 'lifecycle', 'lifecycle_in_progress', 'high', 'cycle de vie : en cours'],
  [/[àa]\s*faire|[àa]\s*r[ée]aliser|[àa]\s*transmettre|pr[ée]vu|planifi|programm|[àa]\s*venir/i, 'lifecycle', 'lifecycle_planned', 'high', 'cycle de vie : planifié / à faire'],
  [/r[ée]alis|\bfait\b|termin|achev|lev[ée]|corrig|ex[ée]cut|accompl|mis\s*en\s*place|pos[ée]|[ée]mis|sold[ée]|100\s*%/i, 'lifecycle', 'lifecycle_done', 'high', 'cycle de vie : fait'],
  [/ouvert|signal[ée]|constat[ée]|non\s*sold/i, 'lifecycle', 'lifecycle_open', 'high', 'cycle de vie : ouvert'],
  // — temporel : conservé mais NON projeté (E ne décide pas du retard) —
  [/en\s*retard|hors\s*d[ée]lai/i, 'temporal', 'lifecycle_open', 'low', 'temporel — conservé, non interprété par E'],
]

/**
 * Classe un verdict documentaire brut par AXE, en normalisant seulement le
 * fiable. Déterministe, pur, sans effet de bord. Ne projette JAMAIS vers l'état
 * métier (E2) et ne juge JAMAIS la présence/le rôle (F/relations).
 */
export function normalizeDocumentVerdict(rawInput: string | null | undefined, ctx: VerdictContext): VerdictCapture {
  const raw = (rawInput ?? '').trim()
  const base = { raw, source: 'rule' as const }

  if (!raw) return { ...base, axis: 'unknown', normalized: null, confidence: 'low', reason: 'verdict absent' }

  // 1. Gardes d'AXE par famille : présence et rôle NE SONT PAS des verdicts de
  //    sujet. On les reconnaît pour les EXCLURE, jamais pour les normaliser ici.
  if (ctx.family === 'person') {
    return { ...base, axis: 'presence', normalized: null, confidence: 'low', reason: 'présence de personne — hors E (relève de F)' }
  }
  if (ctx.family === 'company') {
    return { ...base, axis: 'org_role', normalized: null, confidence: 'low', reason: 'rôle organisationnel — hors E (relations)' }
  }

  const s = raw.toLowerCase()

  // 2. Catégorie thématique égarée dans le champ statut (pollution connue).
  if (THEMATIC_TOKENS.has(s)) {
    return { ...base, axis: 'thematic', normalized: null, confidence: 'low', reason: 'catégorie thématique égarée — non interprétée' }
  }

  // 3. Code court de conformité désambiguïsé PAR LE CONTEXTE (jamais par la
  //    seule chaîne). « NC » seul reste ambigu ; « NC » dans une colonne État /
  //    une grille de contrôle devient compliant_negative. Doit précéder la
  //    garde d'ambiguïté (qui, elle, capte « C » isolé sans contexte probant).
  if (STATE_BEARING.has(ctx.family) && isComplianceGrid(ctx)) {
    const code = s.replace(/[.\s]/g, '')
    const mapped = COMPLIANCE_CODES[code]
    if (mapped) {
      return { ...base, axis: 'compliance', normalized: mapped, confidence: 'medium', reason: 'code de conformité désambiguïsé par le contexte (grille État/contrôle)' }
    }
  }

  // 4. Code intrinsèquement ambigu sans contexte de colonne/formulaire → conservé.
  if (AMBIGUOUS_CODE.test(s)) {
    return { ...base, axis: 'unknown', normalized: null, confidence: 'low', reason: 'code ambigu (lettre/chiffre/couleur) non désambiguïsable sans contexte' }
  }

  // 5. Sur les familles NON porteuses d'état de sujet, on ne fabrique pas de
  //    verdict de conformité/cycle de vie (on conserve le brut).
  if (!STATE_BEARING.has(ctx.family)) {
    return { ...base, axis: 'unknown', normalized: null, confidence: 'low', reason: `famille « ${ctx.family} » non porteuse d'état de sujet` }
  }

  // 6. Règles génériques (multi-vocabulaire), négatifs avant positifs.
  for (const [re, axis, normalized, confidence, reason] of RULES) {
    if (re.test(s)) return { ...base, axis, normalized, confidence, reason }
  }

  // 7. Rien de fiable → CONSERVÉ, non interprété. On ne force jamais.
  return { ...base, axis: 'unknown', normalized: null, confidence: 'low', reason: 'vocabulaire non reconnu — conservé sans interprétation' }
}
