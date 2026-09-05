import { describe, it, expect } from 'vitest'
import { buildDocumentPresenceCells, type RunOccurrence, type SiteSubjectCells } from '@/lib/documents/site-occurrence-timeline'
import { deriveWindowComparison, compareCellsAcrossWindow } from '@/lib/documents/pv-window-comparison'

// AVANT / APRÈS — la primitive doit COMPOSER la fenêtre ]from, to], jamais réinterpréter la
// transition locale du dernier PV. Les cellules sont construites par la VRAIE primitive P0-2
// (`buildDocumentPresenceCells`) : les tests portent donc sur le substrat réel, pas sur des
// cellules fabriquées à la main.

type Step = 'open' | 'resolved' | 'unknown' | 'présent' | 'absent'

const occ = (stateStatus: 'open' | 'resolved' | 'unknown'): RunOccurrence =>
  ({ stateStatus, stateKey: 'action', label: `action:${stateStatus}`, note: null, eventDate: null, sourcePage: null, evidenceCount: 1 })

/** Un sujet = une suite d'états observés PV par PV (chronologie métier `effectiveDate`). */
function cellsOf(steps: Step[]) {
  return buildDocumentPresenceCells(
    steps.map((s, i) => ({
      runId: `r${i + 1}`,
      documentId: `d${i + 1}`,
      effectiveDate: `2025-${String(i + 1).padStart(2, '0')}-15`,
      isPresent: s !== 'absent',
      occs: s === 'absent' || s === 'présent' ? [] : [occ(s)],
    })),
  )
}

function viewOf(subjects: Record<string, Step[]>): SiteSubjectCells {
  const len = Math.max(...Object.values(subjects).map((s) => s.length))
  return {
    siteId: 'site',
    runs: Array.from({ length: len }, (_, i) => ({
      id: `r${i + 1}`,
      documentId: `d${i + 1}`,
      effectiveDate: `2025-${String(i + 1).padStart(2, '0')}-15`,
    })),
    rows: Object.entries(subjects).map(([label, steps]) => ({
      canonicalSubjectId: label,
      label,
      family: 'action',
      thematicCategory: null,
      cells: cellsOf(steps),
    })),
  }
}

function categoryOf(steps: Step[], fromIdx: number, toIdx: number) {
  const view = viewOf({ s: steps })
  const res = deriveWindowComparison(view, `r${fromIdx + 1}`, `r${toIdx + 1}`)
  if (!res.ok) throw new Error(`rejeté: ${res.reason}`)
  return res.data.rows[0]
}

describe('Avant / Après — changements d\'état nets', () => {
  it('open à la borne de départ → resolved à l\'arrivée = RÉSOLU', () => {
    const r = categoryOf(['open', 'open', 'resolved'], 0, 2)
    expect(r.category).toBe('résolu')
    expect(r.beforeState).toBe('open')
    expect(r.afterState).toBe('resolved')
  })

  it('resolved à la borne de départ → open à l\'arrivée = RÉOUVERT', () => {
    const r = categoryOf(['open', 'resolved', 'open'], 1, 2)
    expect(r.category).toBe('réouvert')
    expect(r.beforeState).toBe('resolved')
    expect(r.afterState).toBe('open')
  })

  it('FAUX RÉSOLU évité : déjà resolved AVANT la fenêtre et re-constaté resolved = INCHANGÉ', () => {
    // Le défaut historique de la chaîne locale : `toStatus==='done'` produit toujours « réalisé ».
    const r = categoryOf(['open', 'resolved', 'resolved', 'resolved'], 1, 3)
    expect(r.category).toBe('inchangé')
    expect(r.beforeState).toBe('resolved')
    expect(r.afterState).toBe('resolved')
  })

  it('FAUX APPARU évité : sujet documenté AVANT la fenêtre n\'est jamais « apparu »', () => {
    const r = categoryOf(['open', 'absent', 'absent', 'open'], 1, 3)
    expect(r.category).not.toBe('apparu')
    expect(r.category).toBe('réapparu')
  })

  it('première apparition DANS la fenêtre = APPARU (état d\'arrivée sans effet)', () => {
    const r = categoryOf(['absent', 'absent', 'open', 'resolved'], 1, 3)
    expect(r.category).toBe('apparu')
    expect(r.beforeState).toBe('absent')
  })

  it('silencieux à la borne de départ puis re-mentionné = RÉAPPARU', () => {
    const r = categoryOf(['open', 'absent', 'open'], 1, 2)
    expect(r.category).toBe('réapparu')
    expect(r.presentAtFrom).toBe(false)
    expect(r.presentAtTo).toBe(true)
  })
})

describe('Avant / Après — précision d\'état et fait documentaire', () => {
  it('unknown → connu = ÉTAT PRÉCISÉ (jamais apparu / résolu / réouvert)', () => {
    const r = categoryOf(['unknown', 'unknown', 'open'], 1, 2)
    expect(r.category).toBe('état_précisé')
    expect(r.beforeState).toBe('unknown')
    expect(r.afterState).toBe('open')
  })

  it('unknown → resolved reste ÉTAT PRÉCISÉ, jamais « résolu »', () => {
    const r = categoryOf(['unknown', 'unknown', 'resolved'], 1, 2)
    expect(r.category).toBe('état_précisé')
  })

  it('absence documentaire sur toute la fenêtre = PLUS MENTIONNÉ, état prouvé INCHANGÉ', () => {
    const r = categoryOf(['open', 'absent', 'absent'], 0, 2)
    expect(r.category).toBe('plus_mentionné')
    expect(r.beforeState).toBe('open')
    expect(r.afterState).toBe('open') // une absence ne résout jamais
    expect(r.stateEventCount).toBe(0)
  })

  it('mentionné EN MILIEU de fenêtre mais absent à l\'arrivée = PLUS MENTIONNÉ, jamais « réapparu »', () => {
    const r = categoryOf(['open', 'absent', 'open', 'absent'], 1, 3)
    expect(r.category).toBe('plus_mentionné')
    expect(r.presentAtTo).toBe(false)
  })

  it('une RÉSOLUTION constatée en milieu de fenêtre reste RÉSOLU même si le dernier PV se tait', () => {
    // L'état prouvé prime sur la présence : l'absence ne défait pas une résolution prouvée.
    const r = categoryOf(['open', 'resolved', 'absent'], 0, 2)
    expect(r.category).toBe('résolu')
    expect(r.afterState).toBe('resolved')
    expect(r.presentAtTo).toBe(false)
  })

  it('open re-constaté open = INCHANGÉ (une re-mention n\'est pas un changement)', () => {
    const r = categoryOf(['open', 'open', 'open'], 0, 2)
    expect(r.category).toBe('inchangé')
  })
})

describe('Avant / Après — NET, pas union des événements', () => {
  it('resolved à la borne, re-constaté puis rouvert → net RÉOUVERT (témoin Sprinkler)', () => {
    const r = categoryOf(['resolved', 'resolved', 'open'], 0, 2)
    expect(r.category).toBe('réouvert')
    expect(r.stateEventCount).toBe(2)
  })

  it('open à la borne, plusieurs événements, resolved à l\'arrivée → net RÉSOLU (témoin RIA)', () => {
    const r = categoryOf(['open', 'open', 'resolved'], 0, 2)
    expect(r.category).toBe('résolu')
    expect(r.stateEventCount).toBe(2)
  })

  it('GARDE-FOU CENTRAL : résolu PUIS rouvert dans la fenêtre, mêmes bornes = INCHANGÉ', () => {
    // Union (Évolution) = « 1 résolution + 1 réouverture ». NET (Avant/Après) = rien n'a bougé
    // entre les deux bornes : le sujet était ouvert, il l'est toujours. On ne réinterprète JAMAIS
    // le dernier événement local comme le delta de fenêtre.
    const r = categoryOf(['open', 'resolved', 'open'], 0, 2)
    expect(r.category).toBe('inchangé')
    expect(r.beforeState).toBe('open')
    expect(r.afterState).toBe('open')
    expect(r.stateEventCount).toBe(2) // la matière existe, elle n'est simplement pas un delta
  })

  it('fenêtre MAXIMALE (premier → dernier PV) reste une comparaison de bornes', () => {
    const r = categoryOf(['open', 'resolved', 'open', 'resolved', 'resolved'], 0, 4)
    expect(r.category).toBe('résolu')
    expect(r.beforeState).toBe('open')
    expect(r.afterState).toBe('resolved')
  })

  it('fenêtre ADJACENTE : le net coïncide avec la transition locale correcte', () => {
    expect(categoryOf(['open', 'resolved'], 0, 1).category).toBe('résolu')
    expect(categoryOf(['resolved', 'open'], 0, 1).category).toBe('réouvert')
    expect(categoryOf(['open', 'open'], 0, 1).category).toBe('inchangé')
    expect(categoryOf(['open', 'absent'], 0, 1).category).toBe('plus_mentionné')
  })
})

describe('Avant / Après — garde-fous de bornes', () => {
  const view = viewOf({ a: ['open', 'open', 'resolved'] })

  it('from == to est REFUSÉ', () => {
    expect(deriveWindowComparison(view, 'r2', 'r2')).toEqual({ ok: false, reason: 'same_bounds' })
  })

  it('ordre de bornes invalide (to antérieur à from) est REFUSÉ', () => {
    expect(deriveWindowComparison(view, 'r3', 'r1')).toEqual({ ok: false, reason: 'invalid_order' })
  })

  it('borne inconnue est REFUSÉE', () => {
    expect(deriveWindowComparison(view, 'r1', 'rX')).toEqual({ ok: false, reason: 'unknown_bound' })
  })

  it('chantier sans run historique est REFUSÉ (PETRO : aucun PV importé)', () => {
    expect(deriveWindowComparison({ siteId: 's', runs: [], rows: [] }, 'a', 'b')).toEqual({ ok: false, reason: 'no_runs' })
  })
})

describe('Avant / Après — chronologie métier et population', () => {
  it('les dates rendues sont les dates DOCUMENTAIRES du PV (aucune dépendance à created_at)', () => {
    const view = viewOf({ a: ['open', 'open', 'resolved'] })
    const res = deriveWindowComparison(view, 'r1', 'r3')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.from.effectiveDate).toBe('2025-01-15')
    expect(res.data.to.effectiveDate).toBe('2025-03-15')
    expect(res.data.rows[0].lastEventDate).toBe('2025-03-15')
    // Le type `OccTimelineCell` ne porte AUCUN champ created_at : l'axe est `effectiveDate`.
    expect(Object.keys(view.rows[0].cells[0] ?? {})).not.toContain('createdAt')
  })

  it('un sujet inexistant à la borne d\'arrivée est ABSENT du résultat (rien à comparer)', () => {
    const view = viewOf({ vieux: ['open', 'open', 'open'], futur: ['absent', 'absent', 'absent'] })
    const res = deriveWindowComparison(view, 'r1', 'r3')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.rows.map((r) => r.canonicalSubjectId)).toEqual(['vieux'])
  })

  it('les sujets exclus par l\'appelant (acteurs #228) ne sont pas comparés', () => {
    const view = viewOf({ sujet: ['open', 'resolved'], acteur: ['open', 'resolved'] })
    const res = deriveWindowComparison(view, 'r1', 'r2', new Set(['acteur']))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.rows.map((r) => r.canonicalSubjectId)).toEqual(['sujet'])
    expect(res.data.counts.résolu).toBe(1)
  })

  it('les compteurs couvrent exactement la population comparée', () => {
    const view = viewOf({
      a: ['open', 'open', 'resolved'],       // résolu
      b: ['resolved', 'resolved', 'open'],   // réouvert
      c: ['absent', 'absent', 'open'],       // apparu
      d: ['open', 'absent', 'absent'],       // plus mentionné
      e: ['unknown', 'unknown', 'open'],     // état précisé
      f: ['open', 'open', 'open'],           // inchangé
    })
    const res = deriveWindowComparison(view, 'r1', 'r3')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.counts).toEqual({
      apparu: 1, réapparu: 0, résolu: 1, réouvert: 1, état_précisé: 1, plus_mentionné: 1, inchangé: 1,
    })
    expect(Object.values(res.data.counts).reduce((s, n) => s + n, 0)).toBe(res.data.rows.length)
  })

  it('compareCellsAcrossWindow retourne null quand la cellule d\'arrivée n\'existe pas', () => {
    expect(compareCellsAcrossWindow([null, null], 0, 1)).toBeNull()
  })
})
