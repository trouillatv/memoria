import 'server-only'

// P-UI-R2c — Contexte d'occurrence compact transmis au juge (analyzeSubjectPair).
//
// On a prouvé (P-UI-R2) que le libellé seul ne suffit pas toujours à trancher
// « même objet ? » (Mall vs food court). Le juge a besoin d'un contexte métier
// représentatif issu des occurrences — PAS du document entier :
//   - les occurrences les plus récentes,
//   - pour chacune : libellé + note (tronquée),
// compactées en une chaîne courte et bornée.
//
// Purement en lecture. Ne charge que les sujets demandés (les extrémités des
// paires réellement candidates), jamais tout le chantier.

import { createAdminClient } from '@/lib/supabase/admin'

interface OccRow {
  canonical_subject_id: string
  label: string | null
  note: string | null
  effective_date: string | null
}

export interface OccurrenceContextOptions {
  /** Occurrences (les plus récentes) retenues par sujet. Défaut 3. */
  maxPerSubject?: number
  /** Longueur max de la note par occurrence (tronquée avec …). Défaut 160. */
  maxNoteChars?: number
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Compacte les occurrences d'un sujet (déjà triées récent→ancien) en une chaîne bornée. */
export function formatOccurrenceContext(
  rows: Array<{ label: string | null; note: string | null }>,
  maxPerSubject: number,
  maxNoteChars: number,
): string | null {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (parts.length >= maxPerSubject) break
    const label = (r.label ?? '').trim()
    const note = (r.note ?? '').trim()
    const piece = note ? `${label ? `${label} — ` : ''}${truncate(note, maxNoteChars)}` : label
    if (!piece) continue
    const dedupKey = piece.toLowerCase()
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    parts.push(piece)
  }
  return parts.length ? parts.join(' | ') : null
}

/**
 * Charge un contexte d'occurrence compact pour chaque sujet demandé.
 * Retourne une Map subjectId → contexte (absent si aucune occurrence utile).
 */
export async function loadOccurrenceContextMap(
  subjectIds: string[],
  opts: OccurrenceContextOptions = {},
): Promise<Map<string, string>> {
  const maxPerSubject = opts.maxPerSubject ?? 3
  const maxNoteChars = opts.maxNoteChars ?? 160
  const result = new Map<string, string>()
  const ids = [...new Set(subjectIds)].filter(Boolean)
  if (ids.length === 0) return result

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, label, note, effective_date')
    .in('canonical_subject_id', ids)
    .order('effective_date', { ascending: false })

  const byId = new Map<string, OccRow[]>()
  for (const row of (data ?? []) as OccRow[]) {
    if (!byId.has(row.canonical_subject_id)) byId.set(row.canonical_subject_id, [])
    byId.get(row.canonical_subject_id)!.push(row)
  }

  for (const [id, rows] of byId) {
    const ctx = formatOccurrenceContext(rows, maxPerSubject, maxNoteChars)
    if (ctx) result.set(id, ctx)
  }
  return result
}
