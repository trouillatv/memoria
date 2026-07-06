'use server'

// Recherche transversale dans TOUT le patrimoine du chantier, REGROUPÉE par type.
// « Dis-moi ce que tu cherches, je retrouve toute l'histoire de ce chantier. »
// Déterministe : full-text (RPC search_memory) — zéro IA, zéro donnée inventée.
// La recherche ne traverse jamais de données per-personne (doctrine mémoire V5).

import { requireFieldAgent } from '@/lib/field/auth'
import { searchMemory, type MemoryHitType } from '@/lib/db/memory-search'

export interface PatrimoineHit { id: string; title: string; snippet: string; occurredAt: string }
export interface PatrimoineGroup { type: MemoryHitType; count: number; items: PatrimoineHit[] }
export type SearchPatrimoineResult =
  | { ok: true; q: string; total: number; groups: PatrimoineGroup[] }
  | { ok: false; error: string }

// Ordre d'affichage des groupes (les preuves d'abord, puis les décisions/docs).
const GROUP_ORDER: MemoryHitType[] = [
  'photo', 'site_note', 'site_reserve', 'site_action', 'meeting_decision', 'report_document', 'intervention', 'anomaly',
]

export async function searchPatrimoineAction(siteId: string, q: string): Promise<SearchPatrimoineResult> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const term = q.trim()
  if (term.length < 2) return { ok: true, q: term, total: 0, groups: [] }

  const hits = await searchMemory({ q: term, siteId, periodDays: 3650, limit: 60 }).catch(() => [])
  const byType = new Map<MemoryHitType, PatrimoineHit[]>()
  for (const h of hits) {
    const arr = byType.get(h.type) ?? []
    arr.push({ id: h.id, title: h.title, snippet: h.snippet, occurredAt: h.occurredAt })
    byType.set(h.type, arr)
  }
  const groups: PatrimoineGroup[] = GROUP_ORDER
    .filter((t) => byType.has(t))
    .map((t) => ({ type: t, count: byType.get(t)!.length, items: byType.get(t)!.slice(0, 4) }))

  return { ok: true, q: term, total: hits.length, groups }
}
