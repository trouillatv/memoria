import 'server-only'

// P0 — RÉSUMÉ DELTA OCCURRENCE-FIRST entre deux PV, catégories SÉPARÉES.
//
// Source de vérité unique = `getPvDelta` (occurrence-first, `buildSiteSubjectCells` +
// `cellDeltaTransition`), la MÊME que l'Aperçu #230, la Chronologie, les Lignes de vie
// et les fiches. Remplace le legacy `getCanonicalDelta`/`computeDeltaSummary` pour la
// Synthèse (Histoire), qui excluait la famille `knowledge_fact` et fusionnait
// aggravé/réouvert. Ici :
//   - réouvert ≠ aggravé (jamais fusionnés) ;
//   - nouveau ≠ réapparu (axe de présence) ;
//   - non-mention ≠ résolution ;
//   - SEULS les acteurs (durableKind=actor, #228) sont exclus — `knowledge_fact` gardé ;
//   - labels CANONIQUES (cohérence inter-vues).
// Différent de #230 par la PROJECTION (listes complètes, non cappées), pas par la vérité.

import { createAdminClient } from '@/lib/supabase/admin'
import { getPvDelta } from './pv-comparison'
import { buildSiteSubjectCells } from './site-occurrence-timeline'

export interface PvSubjectRef {
  canonicalSubjectId: string
  label: string
}

export interface OccurrencePvSummary {
  réouvert: PvSubjectRef[]
  aggravé: PvSubjectRef[]
  nouveau: PvSubjectRef[]
  réapparu: PvSubjectRef[]
  résolu: PvSubjectRef[]      // levé + réalisé
  progressé: PvSubjectRef[]
  maintenu: PvSubjectRef[]
  nonMentionné: PvSubjectRef[]
  annulé: PvSubjectRef[]
  changé: PvSubjectRef[]
}

export function emptyOccurrencePvSummary(): OccurrencePvSummary {
  return { réouvert: [], aggravé: [], nouveau: [], réapparu: [], résolu: [], progressé: [], maintenu: [], nonMentionné: [], annulé: [], changé: [] }
}

/** Nombre total de vrais changements (hors maintenu/non-mentionné) — pour un éventuel « rien de neuf ». */
export function countRealChanges(s: OccurrencePvSummary): number {
  return s.réouvert.length + s.aggravé.length + s.nouveau.length + s.réapparu.length + s.résolu.length + s.progressé.length + s.annulé.length + s.changé.length
}

export async function buildOccurrencePvSummary(
  siteId: string,
  fromRunId: string,
  toRunId: string,
): Promise<OccurrencePvSummary> {
  const [delta, view] = await Promise.all([
    getPvDelta(fromRunId, toRunId).catch(() => null),
    buildSiteSubjectCells(siteId).catch(() => null),
  ])
  const s = emptyOccurrencePvSummary()
  if (!delta) return s

  const toIdx = view ? view.runs.findIndex((r) => r.id === toRunId) : -1
  const cellsByCs = new Map((view?.rows ?? []).map((r) => [r.canonicalSubjectId, r.cells]))

  // Population : exclure les acteurs (#228) ; label canonique.
  const csIds = [...new Set(delta.items.map((i) => i.subjectThreadId))]
  const actorCs = new Set<string>()
  const labelByCs = new Map<string, string>()
  const admin = createAdminClient()
  for (let i = 0; i < csIds.length; i += 300) {
    const { data } = await admin.from('canonical_subject').select('id, kind, label').in('id', csIds.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ id: string; kind: string | null; label: string | null }>) {
      if (r.kind === 'actor') actorCs.add(r.id)
      if (r.label) labelByCs.set(r.id, r.label)
    }
  }

  for (const it of delta.items) {
    if (actorCs.has(it.subjectThreadId)) continue
    const ref: PvSubjectRef = { canonicalSubjectId: it.subjectThreadId, label: labelByCs.get(it.subjectThreadId) ?? it.label }
    switch (it.transition) {
      case 'réouvert': s.réouvert.push(ref); break
      case 'aggravé':  s.aggravé.push(ref); break
      case 'nouveau': {
        // Raffinement nouveau vs réapparu depuis l'axe de PRÉSENCE (comme #230).
        const cells = cellsByCs.get(it.subjectThreadId) ?? []
        const firstReal = cells.findIndex((c) => c && !c.isGap)
        ;(firstReal >= 0 && toIdx >= 0 && firstReal < toIdx ? s.réapparu : s.nouveau).push(ref)
        break
      }
      case 'levé':
      case 'réalisé':      s.résolu.push(ref); break
      case 'progressé':    s.progressé.push(ref); break
      case 'maintenu':     s.maintenu.push(ref); break
      case 'non_mentionné': s.nonMentionné.push(ref); break
      case 'annulé':       s.annulé.push(ref); break
      default:             s.changé.push(ref); break
    }
  }
  return s
}
