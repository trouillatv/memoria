// P3-D2 — Date PROPRE d'un état/événement, distincte de la date du document.
//
// Réutilise la brique déterministe existante `detectDocumentDate` (P0-B), qui classe déjà les dates
// candidates par sémantique — dont `event_date` (« réalisé/contrôlé le … », date suivie d'un
// organisme) et `deadline_date` (« à refaire avant … »). AUCUN second pipeline LLM.
//
// Contrat (Vincent, P3-D2) :
//   - on ne remonte QUE les dates de sémantique `event_date` (fait daté), jamais visite/échéance/
//     référence/visite-précédente ;
//   - absence de date événementielle fiable → null (JAMAIS recopier la date du PV) ;
//   - date partielle (ex. « 04/23 » = mois/année, sans jour) → non structurée → null (reste dans le
//     texte) ; la brique numérique exige jour+mois+année, donc « 04/23 » n'est pas extrait ;
//   - plusieurs dates événementielles distinctes → on prend la plus CONFIANTE ; à confiance
//     comparable (écart ≤ 0.15) → ambiguous=true et iso=null (ne jamais choisir naïvement la première).

import { detectDocumentDate } from './detect-document-date'

export interface EventDateResult {
  /** Date propre de l'événement (ISO) si fiable, sinon null. */
  iso: string | null
  /** true si plusieurs dates événementielles distinctes de confiance comparable → non tranché. */
  ambiguous: boolean
  /** Extrait de preuve autour de la date retenue (ou de l'ambiguïté), pour la revue/dry-run. */
  evidence: string | null
}

const EMPTY: EventDateResult = { iso: null, ambiguous: false, evidence: null }

/**
 * Extrait la date propre de l'événement à partir des textes d'un état (label, description, extrait).
 * Concatène les textes (une preuve peut porter la date), puis ne retient que les candidats
 * `event_date`.
 */
export function extractEventDate(texts: (string | null | undefined)[]): EventDateResult {
  const text = texts.filter((t) => !!t && t.trim()).join('\n').trim()
  if (!text) return EMPTY

  const { candidates } = detectDocumentDate(text)
  const events = candidates.filter((c) => c.semantics === 'event_date')
  if (events.length === 0) return EMPTY

  // Dédupliquer par ISO en gardant la plus confiante.
  const byIso = new Map<string, typeof events[number]>()
  for (const c of events) {
    const prev = byIso.get(c.iso)
    if (!prev || c.confidence > prev.confidence) byIso.set(c.iso, c)
  }
  const distinct = [...byIso.values()].sort((a, b) => b.confidence - a.confidence)

  if (distinct.length === 1) return { iso: distinct[0].iso, ambiguous: false, evidence: distinct[0].evidence }

  // Plusieurs dates événementielles distinctes : ambiguïté si les deux meilleures sont trop proches.
  const ambiguous = distinct[1].confidence >= distinct[0].confidence - 0.15
  return ambiguous
    ? { iso: null, ambiguous: true, evidence: distinct.map((c) => `${c.iso} (${c.evidence})`).join(' | ') }
    : { iso: distinct[0].iso, ambiguous: false, evidence: distinct[0].evidence }
}
