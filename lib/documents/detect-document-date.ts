// Détection générique de la date d'un document PV/CR (P0-B, Vincent 2026-08-27).
//
// Motivation : la date de visite était saisie à la main à l'upload, jamais recroisée
// avec le document → 2 imports sur 2 avec une date fausse (2024 inversée ; 2025 = date
// du contrôle MIES 17/07 au lieu de la visite 05/08). Cette brique lit le TEXTE extrait
// et remonte un contrat STRUCTURÉ : chaque date candidate avec sa sémantique probable,
// sa preuve (extrait + page), sa confiance ; puis la meilleure date de document et un
// drapeau d'ambiguïté. Elle NE tranche jamais artificiellement : plusieurs dates de
// visite plausibles → ambiguous=true, l'humain confirme à la revue.
//
// STRICTEMENT GÉNÉRIQUE : aucun mot-clé propre à CAPSE/Bella Napoli, aucune dépendance à
// la position dans la page, au numéro de page, à un template 2024/2025, ni à une
// expression exacte unique. Les indices textuels employés sont des tournures FR
// courantes de CR (« date de la visite », « visite du », « fait le … par … »,
// « visite précédente », « arrêté du … ») — jamais une exception codée pour ce corpus.
//
// Déterministe (aucun LLM) : testable et reproductible. Prépare l'option B (lecture du
// document AVANT de figer la date) et la distinction des trois temporalités à venir
// (date du document ≠ date d'un fait ≠ échéance).

export type DateSemantics =
  | 'visit_date'          // date de LA visite/du CR (ce qu'on cherche)
  | 'meeting_date'        // date d'une réunion
  | 'report_date'         // date d'émission du compte-rendu
  | 'previous_visit_date' // « visite précédente »
  | 'event_date'          // fait métier daté (contrôle/intervention réalisé le …)
  | 'deadline_date'       // échéance (« avant novembre », « au plus tard le … »)
  | 'reference_date'      // date réglementaire (arrêté/délibération/loi du …)
  | 'unknown'

export interface DateCandidate {
  raw: string           // texte brut trouvé, ex. « 05/08/2025 » ou « 19 juillet 2024 »
  iso: string           // « 2025-08-05 »
  semantics: DateSemantics
  confidence: number    // 0..1
  evidence: string      // extrait de contexte autour de la date
  page: number | null   // si des marqueurs [[page N]] existent
}

export interface DocumentDateDetection {
  candidates: DateCandidate[]
  best: DateCandidate | null // meilleure date de document/visite, ou null si aucune exploitable
  ambiguous: boolean         // plusieurs dates de visite plausibles → ne pas trancher
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function toIso(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const y = year < 100 ? 2000 + year : year
  if (y < 1900 || y > 2100) return null
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  // Validation calendaire basique (rejette 31/02 etc.)
  const dt = new Date(Date.UTC(y, month - 1, day))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${y}-${mm}-${dd}`
}

interface RawHit { raw: string; iso: string; index: number }

// Extrait toutes les dates candidates (numériques JJ/MM/AA[AA] et textuelles « 19 juillet 2024 »).
function extractRawHits(text: string): RawHit[] {
  const hits: RawHit[] = []
  const numeric = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g
  for (let m; (m = numeric.exec(text)); ) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) hits.push({ raw: m[0], iso, index: m.index })
  }
  const textual = /\b(\d{1,2})\s+([A-Za-zéûôàèùâêîïç]+)\s+(\d{4})\b/g
  for (let m; (m = textual.exec(text)); ) {
    const mon = MONTHS[stripAccents(m[2].toLowerCase())]
    if (!mon) continue
    const iso = toIso(Number(m[1]), mon, Number(m[3]))
    if (iso) hits.push({ raw: m[0], iso, index: m.index })
  }
  // « CR visite 050825 » / « visite du 050825 » : forme compacte DDMMYY collée à un
  // indice de visite fort. On la matérialise en candidat pour qu'elle soit classée visite.
  const compact = /\b(?:cr\s+visite|visite)\s+(\d{2})(\d{2})(\d{2})\b/gi
  for (let m; (m = compact.exec(text)); ) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) hits.push({ raw: m[0], iso, index: m.index })
  }
  // « JJ et JJ/MM/AAAA » / « JJ, JJ/MM/AAAA » : énumération compacte de deux dates
  // partageant le même mois/année (ex. « visite du 27 et 31/03/2025 »). Sans ce motif,
  // seule la date complète (31/03/2025) serait candidate et « visite du » la classerait
  // seule comme confirmée, alors que le document désigne deux dates distinctes.
  const enumPair = /\b(\d{1,2})\s*(?:et|,)\s*((\d{1,2})[/.](\d{1,2})[/.](\d{2,4}))\b/g
  for (let m; (m = enumPair.exec(text)); ) {
    const month = Number(m[4])
    const year = Number(m[5])
    const iso1 = toIso(Number(m[1]), month, year)
    const iso2 = toIso(Number(m[3]), month, year)
    const offset2 = m.index + m[0].indexOf(m[2])
    if (iso1) hits.push({ raw: m[1], iso: iso1, index: m.index })
    if (iso2) hits.push({ raw: m[2], iso: iso2, index: offset2 })
  }
  return hits.sort((a, b) => a.index - b.index)
}

function pageAt(text: string, index: number): number | null {
  // Marqueurs « [[page N]] » (posés par l'extraction texte). Dernier avant l'index.
  const re = /\[\[page\s+(\d+)\]\]/gi
  let page: number | null = null
  for (let m; (m = re.exec(text)); ) {
    if (m.index > index) break
    page = Number(m[1])
  }
  return page
}

// Classe une date d'après des indices textuels génériques dans une fenêtre autour d'elle.
function classify(text: string, hit: RawHit): { semantics: DateSemantics; confidence: number; evidence: string } {
  // Fenêtre de contexte AMONT restreinte à la MÊME ligne (bornée à 48 car.) : un indice
  // ne doit pas « fuir » d'une ligne à l'autre vers la date suivante (ex. « visite
  // précédente : 19/07/2024 » ne doit pas classer le 17/07 de la ligne d'après). Générique.
  const lineStart = text.lastIndexOf('\n', hit.index - 1) + 1
  const before = stripAccents(text.slice(Math.max(lineStart, hit.index - 48), hit.index).toLowerCase())
  const afterRaw = text.slice(hit.index + hit.raw.length, hit.index + hit.raw.length + 24)
  const evidence = text.slice(Math.max(0, hit.index - 40), hit.index + hit.raw.length + 30).replace(/\s+/g, ' ').trim()

  // 1. Référence réglementaire : « arrêté/délibération/loi/décret/circulaire … du <date> »
  if (/\b(arrete|deliberation|loi|decret|circulaire|reglement)\b[^.]{0,40}$/.test(before)) {
    return { semantics: 'reference_date', confidence: 0.9, evidence }
  }
  // 2. Visite précédente / dernière visite
  if (/(visite\s+precedente|precedente\s+visite|derniere\s+visite|visite\s+anterieure)[^.]{0,30}$/.test(before)) {
    return { semantics: 'previous_visit_date', confidence: 0.85, evidence }
  }
  // 3. Indice de visite FORT (la forme compacte « cr visite/visite <ddmmyy> » ou une tournure explicite)
  if (/\b(?:cr\s+visite|visite)\s+\d{6}\b/i.test(hit.raw)) {
    return { semantics: 'visit_date', confidence: 0.9, evidence }
  }
  if (/(date\s+de\s+la\s+visite|visite\s+du|visite\s+le|compte[- ]?rendu\s+du|cr\s+du|date\s+du\s+cr)[^.]{0,12}$/.test(before)) {
    return { semantics: 'visit_date', confidence: 0.9, evidence }
  }
  if (/\bdu$/.test(before.trim()) && /\bvisite\b/.test(before)) {
    return { semantics: 'visit_date', confidence: 0.8, evidence } // « VISITE … DU <date> »
  }
  if (/(reunion\s+du|reunion\s+le)[^.]{0,12}$/.test(before)) {
    return { semantics: 'meeting_date', confidence: 0.85, evidence }
  }
  // « DATE : <date> » en début de ligne (indice d'en-tête générique)
  if (/(^|\n)\s*date\s*:?\s*$/.test(before)) {
    return { semantics: 'report_date', confidence: 0.75, evidence }
  }
  // 4. Échéance
  if (/(avant|d'?ici|au\s+plus\s+tard|echeance|prevoir\s+.{0,20}|a\s+refaire\s+avant)[^.]{0,20}$/.test(before)) {
    return { semantics: 'deadline_date', confidence: 0.7, evidence }
  }
  // 5. Événement métier daté : « fait/réalisé/contrôlé le <date> » OU date suivie d'un
  //    acteur/organisme (acronyme MAJ ≥3 lettres, ou « Bureau <Maj> ») — générique.
  if (/(fait|realise|realisee|controle|controlee|effectue|effectuee|intervention|contro?le)\s*(le|en|:)?\s*$/.test(before)) {
    return { semantics: 'event_date', confidence: 0.8, evidence }
  }
  // 5b. Verbe de réalisation/contrôle PUIS acteur intercalé PUIS « … le <date> » (ex.
  //     « contrôlées par Bureau Veritas le 22/03/2024 ») — le verbe n'est pas collé à « le ».
  //     Exclut les FORMULATIONS PRÉVISIONNELLES (« prochain contrôle prévu le … ») = échéance,
  //     pas un fait passé.
  if (
    /\b(fait|realise|realisee|realisees|controle|controlee|controlees|effectue|effectuee|verifie|verifiee|intervention)\b/.test(before)
    && /\b(le|en)\s*$/.test(before)
    && !/\b(prochain|prevu|prevue|prevoir|prevision|a\s+prevoir|programme|planifie)\b/.test(before)
  ) {
    return { semantics: 'event_date', confidence: 0.75, evidence }
  }
  if (/^\s*(?:par\s+)?[A-ZÉÈ][A-ZÉÈ]{2,}\b/.test(afterRaw) || /^\s*(?:par\s+)?Bureau\s+[A-ZÉ]/.test(afterRaw)) {
    return { semantics: 'event_date', confidence: 0.7, evidence } // « <date> MIES/KFT/… » ou « <date> Bureau V… »
  }
  return { semantics: 'unknown', confidence: 0.3, evidence }
}

function dedupeByIsoKeepStrongest(cands: DateCandidate[]): DateCandidate[] {
  const byIso = new Map<string, DateCandidate>()
  for (const c of cands) {
    const prev = byIso.get(c.iso)
    if (!prev || c.confidence > prev.confidence) byIso.set(c.iso, c)
  }
  return [...byIso.values()]
}

/**
 * Détecte la date du document/visite et toutes les dates candidates avec leur sémantique.
 * `best` = meilleure date de visite/document (ou null si aucune exploitable).
 * `ambiguous` = plusieurs dates de visite plausibles et distinctes → l'humain tranche.
 */
export function detectDocumentDate(text: string): DocumentDateDetection {
  if (!text || !text.trim()) return { candidates: [], best: null, ambiguous: false }

  const raw = extractRawHits(text)
  const candidates: DateCandidate[] = raw.map((h) => {
    const { semantics, confidence, evidence } = classify(text, h)
    return { raw: h.raw, iso: h.iso, semantics, confidence, evidence, page: pageAt(text, h.index) }
  })

  // Sélection de la meilleure date de DOCUMENT/VISITE.
  const documentish = candidates.filter((c) =>
    c.semantics === 'visit_date' || c.semantics === 'meeting_date' || c.semantics === 'report_date',
  )
  const strong = dedupeByIsoKeepStrongest(documentish).sort((a, b) => b.confidence - a.confidence)

  if (strong.length > 0) {
    const distinctIsos = new Set(strong.map((c) => c.iso))
    // Ambigu seulement si deux dates de visite DISTINCTES de confiance comparable.
    const ambiguous = distinctIsos.size > 1 && strong[1].confidence >= strong[0].confidence - 0.15
    return { candidates, best: strong[0], ambiguous }
  }

  // Aucune date de visite explicite : repli prudent sur les dates NEUTRES (unknown) —
  // jamais sur une date d'événement/échéance/référence/visite précédente.
  const neutral = dedupeByIsoKeepStrongest(candidates.filter((c) => c.semantics === 'unknown'))
  if (neutral.length === 1) return { candidates, best: neutral[0], ambiguous: false }
  if (neutral.length > 1) return { candidates, best: null, ambiguous: true }
  return { candidates, best: null, ambiguous: false }
}

// ─── Signal « pas de visite terrain » ────────────────────────────────────────
// Finding #1 (chantier fermeture extraction historique) : un document peut porter une
// date crédible sans qu'aucune visite de site n'ait eu lieu ce jour-là (ex. point de
// suivi en bureau). detectDocumentDate() ne juge jamais CE point — il détecte des dates,
// pas des événements. Cette fonction est un signal SÉPARÉ et volontairement étroit :
// STRICTEMENT GÉNÉRIQUE (aucun mot-clé de chantier précis), elle ne sert qu'à déclencher
// un avertissement + une confirmation humaine avant matérialisation ; elle ne bloque rien
// silencieusement et ne redéfinit jamais `origin` (invariant gelé, cf. lib/field/visit-origins.ts).

export interface NonVisitSignal {
  detected: boolean
  evidence: string | null
  page: number | null
}

export function detectNonVisitSignal(text: string): NonVisitSignal {
  if (!text || !text.trim()) return { detected: false, evidence: null, page: null }
  const re = /\b(?:pas|aucune|sans)\s+(?:de\s+|d')?visite\b(?:\s+(?:de\s+|du\s+)?(?:site|terrain|chantier))?/gi
  const m = re.exec(text)
  if (!m) return { detected: false, evidence: null, page: null }
  const evidence = text
    .slice(Math.max(0, m.index - 20), m.index + m[0].length + 60)
    .replace(/\s+/g, ' ')
    .trim()
  return { detected: true, evidence, page: pageAt(text, m.index) }
}
