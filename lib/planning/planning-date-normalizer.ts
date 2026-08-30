import 'server-only'

export type DateBasisKind = 'explicit_document' | 'document_context'

export interface YearAnchor {
  year: number
  basis: DateBasisKind
}

export interface NormalizedPlanningDate {
  normalizedDate: string | null
  normalizedEndDate: string | null
  temporalPrecision: 'day' | 'week' | 'range' | 'unknown'
  dateBasis: DateBasisKind | null
}

// ─── Extraction ancre d'année depuis le texte PDF ─────────────────────────────

// Plage d'années plausibles pour un planning de chantier
const YEAR_RE = /\b(202[4-9]|203\d)\b/g

/**
 * Scanne le texte PDF brut pour trouver une ancre d'année.
 * Retourne l'année la plus fréquente dans la plage plausible.
 * Priorité : explicit_document si l'année apparaît dans une date complète JJ/MM/AAAA.
 * Sinon : document_context.
 * Retourne null si aucune année détectable.
 */
export function extractYearAnchor(pdfText: string): YearAnchor | null {
  const years: number[] = [...pdfText.matchAll(YEAR_RE)].map((m) => parseInt(m[1], 10))
  if (years.length === 0) return null

  const counts = new Map<number, number>()
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const year = sorted[0][0]

  // Vérifier si l'année apparaît dans une date complète (JJ/MM/AAAA ou DD-MM-YYYY)
  const explicitPattern = new RegExp(`\\b\\d{1,2}[/\\-]\\d{1,2}[/\\-]${year}\\b`)
  const basis: DateBasisKind = explicitPattern.test(pdfText) ? 'explicit_document' : 'document_context'

  return { year, basis }
}

// ─── Parsing date française ───────────────────────────────────────────────────

const FRENCH_MONTH: Record<string, number> = {
  jan: 1, fev: 2, fév: 2, mar: 3, avr: 4, mai: 5,
  juin: 6, jul: 7, juil: 7, aou: 8, aoû: 8, sep: 9, oct: 10, nov: 11, dec: 12, déc: 12,
}

function parseFrenchDate(raw: string | null): { day: number; month: number } | null {
  if (!raw) return null
  const norm = raw.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[\s\-–]+/g, ' ').trim()
  const m = norm.match(/^(\d{1,2})\s+([a-z]+)/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  if (day < 1 || day > 31) return null
  const abbr = m[2].slice(0, 3)
  const month = FRENCH_MONTH[abbr] ?? FRENCH_MONTH[m[2]] ?? null
  if (!month) return null
  return { day, month }
}

// ─── Parsing numéro de semaine ────────────────────────────────────────────────

function parseWeekRange(raw: string | null): { startWeek: number; endWeek: number } | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/)
  if (!m) return null
  const startWeek = parseInt(m[1], 10)
  const endWeek = m[2] ? parseInt(m[2], 10) : startWeek
  if (startWeek < 1 || startWeek > 53 || endWeek < startWeek) return null
  return { startWeek, endWeek }
}

// ─── Calcul calendrier ISO ────────────────────────────────────────────────────

function isoDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Lundi de la semaine ISO week dans l'année year */
function mondayOfISOWeek(year: number, week: number): string {
  // Jan 4 est toujours en semaine 1 (ISO 8601)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7  // 1=lun … 7=dim
  const mondayW1 = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000)
  const monday = new Date(mondayW1.getTime() + (week - 1) * 7 * 86_400_000)
  return isoDateStr(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
}

/** Dimanche de la semaine ISO week dans l'année year */
function sundayOfISOWeek(year: number, week: number): string {
  const [y, mo, d] = mondayOfISOWeek(year, week).split('-').map(Number)
  const sun = new Date(Date.UTC(y, mo - 1, d + 6))
  return isoDateStr(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate())
}

// ─── Normaliseur principal ────────────────────────────────────────────────────

/**
 * Normalise la paire rawDateText/rawWeekText en dates ISO déterministes.
 *
 * Règles :
 * 1. La date textuelle explicite prime en cas de contradiction avec le n° de semaine.
 * 2. Si rawWeekText est une plage (S39-40), planned_end = dimanche de la dernière semaine.
 * 3. Sans ancre d'année prouvable → normalizedDate = null.
 * 4. La date d'upload N'EST PAS une ancre valide ; utiliser extractYearAnchor().
 */
export function normalizePlanningDate(
  rawDateText: string | null,
  rawWeekText: string | null,
  anchor: YearAnchor | null,
): NormalizedPlanningDate {
  if (!anchor) {
    return { normalizedDate: null, normalizedEndDate: null, temporalPrecision: 'unknown', dateBasis: null }
  }

  const parsed = parseFrenchDate(rawDateText)
  const weeks = parseWeekRange(rawWeekText)

  if (!parsed && !weeks) {
    return { normalizedDate: null, normalizedEndDate: null, temporalPrecision: 'unknown', dateBasis: null }
  }

  const { year, basis } = anchor

  if (parsed && weeks) {
    // Date explicite + semaine : date prime, plage de semaines donne la fin
    const start = isoDateStr(year, parsed.month, parsed.day)
    const isRange = weeks.endWeek > weeks.startWeek
    const end = isRange ? sundayOfISOWeek(year, weeks.endWeek) : null
    return {
      normalizedDate: start,
      normalizedEndDate: end,
      temporalPrecision: isRange ? 'range' : 'day',
      dateBasis: basis,
    }
  }

  if (parsed) {
    // Date seule, pas de semaine
    return {
      normalizedDate: isoDateStr(year, parsed.month, parsed.day),
      normalizedEndDate: null,
      temporalPrecision: 'day',
      dateBasis: basis,
    }
  }

  // Semaine seule (sans date textuelle)
  const start = mondayOfISOWeek(year, weeks!.startWeek)
  const end = weeks!.endWeek > weeks!.startWeek
    ? sundayOfISOWeek(year, weeks!.endWeek)
    : sundayOfISOWeek(year, weeks!.startWeek)
  return {
    normalizedDate: start,
    normalizedEndDate: end,
    temporalPrecision: weeks!.endWeek > weeks!.startWeek ? 'range' : 'week',
    dateBasis: basis,
  }
}
