import { describe, it, expect } from 'vitest'
import { buildOccurrenceCells, buildDocumentPresenceCells, type RunOccurrence } from '@/lib/documents/site-occurrence-timeline'

// P0-2 — primitive neutre. Invariant : la non-mention reporte le dernier état PROUVÉ (jamais
// open→unknown→unknown→resolved) ; isMentioned distingue « état porté » de « preuve observée ».

const occ = (stateStatus: 'open' | 'resolved' | 'unknown', stateKey = 'action', eventDate: string | null = null): RunOccurrence =>
  ({ stateStatus, stateKey, label: `${stateKey}:${stateStatus}`, note: null, eventDate, sourcePage: null, evidenceCount: 1 })

const run = (id: string, occs: RunOccurrence[]) => ({ runId: id, documentId: `d${id}`, effectiveDate: `2024-0${id}-01`, occs })

describe('buildOccurrenceCells — report du dernier état prouvé', () => {
  it('ouvert puis NON MENTIONNÉ → état porté reste open, isMentioned=false, aucun événement d\'état', () => {
    const cells = buildOccurrenceCells([run('1', [occ('open')]), run('2', []), run('3', [])])
    expect(cells.map((c) => c!.currentProvenState)).toEqual(['open', 'open', 'open'])
    expect(cells.map((c) => c!.isMentioned)).toEqual([true, false, false])
    expect(cells.map((c) => c!.observedTriState)).toEqual(['open', null, null])
    expect(cells.map((c) => c!.isGap)).toEqual([false, true, true])
    expect(cells[1]!.transition).toBe('non_mentionné')
  })

  it('ouvert → RÉSOLU prouvé → non mentionné : proven passe à resolved puis se reporte', () => {
    const cells = buildOccurrenceCells([run('1', [occ('open')]), run('2', [occ('resolved', 'knowledge_fact')]), run('3', [])])
    expect(cells.map((c) => c!.currentProvenState)).toEqual(['open', 'resolved', 'resolved'])
    expect(cells[1]!.observedTriState).toBe('resolved')
  })

  it('résolu puis RÉOUVERT → transition réouvert, proven repasse open', () => {
    const cells = buildOccurrenceCells([run('1', [occ('resolved', 'knowledge_fact')]), run('2', [occ('open')])])
    expect(cells[0]!.currentProvenState).toBe('resolved')
    expect(cells[1]!.currentProvenState).toBe('open')
    expect(cells[1]!.transition).toBe('réouvert')
  })

  it('unknown observé ne change PAS l\'état porté', () => {
    const cells = buildOccurrenceCells([run('1', [occ('open')]), run('2', [occ('unknown', 'observation')])])
    expect(cells[0]!.currentProvenState).toBe('open')
    expect(cells[1]!.observedTriState).toBe('unknown')
    expect(cells[1]!.currentProvenState).toBe('open') // porté conservé
  })

  it('cellules null AVANT la première apparition', () => {
    const cells = buildOccurrenceCells([run('1', []), run('2', [occ('open')]), run('3', [])])
    expect(cells[0]).toBeNull()
    expect(cells[1]!.isMentioned).toBe(true)
    expect(cells[1]!.transition).toBeNull() // première occurrence réelle
    expect(cells[2]!.isGap).toBe(true)
  })

  it('multiplicité intra-PV : open + resolved dans le même run → observé open (concern), primaire = action', () => {
    const cells = buildOccurrenceCells([run('1', [occ('resolved', 'knowledge_fact'), occ('open', 'action')])])
    expect(cells[0]!.observedTriState).toBe('open')
    expect(cells[0]!.stateKey).toBe('action')
  })

  it('event_date = plus petite date des occurrences du run (position)', () => {
    const cells = buildOccurrenceCells([run('1', [occ('resolved', 'knowledge_fact', '2024-03-22'), occ('open', 'action', null)])])
    expect(cells[0]!.eventDate).toBe('2024-03-22')
  })
})

// P0-2b — présence documentaire vs état occurrence.
const prun = (id: string, isPresent: boolean, occs: RunOccurrence[]) =>
  ({ runId: id, documentId: `d${id}`, effectiveDate: `2024-0${id}-01`, isPresent, occs })

describe('buildDocumentPresenceCells — présence ≠ état', () => {
  it('présent SANS occurrence éligible → isGap=false, isMentioned=true, pas de transition, état porté conservé', () => {
    const cells = buildDocumentPresenceCells([prun('1', true, [occ('open')]), prun('2', true, []), prun('3', true, [])])
    expect(cells.map((c) => c!.isGap)).toEqual([false, false, false])       // JAMAIS gap : présent
    expect(cells.map((c) => c!.isMentioned)).toEqual([true, true, true])    // présence documentaire
    expect(cells.map((c) => c!.observedTriState)).toEqual(['open', null, null]) // pas d'état inventé
    expect(cells.map((c) => c!.transition)).toEqual([null, null, null])     // aucune transition (pas 1re occ ⇒ null)
    expect(cells.map((c) => c!.currentProvenState)).toEqual(['open', 'open', 'open']) // report
  })

  it('ABSENT du document (isPresent=false) → gap non_mentionné', () => {
    const cells = buildDocumentPresenceCells([prun('1', true, [occ('open')]), prun('2', false, [])])
    expect(cells[1]!.isGap).toBe(true)
    expect(cells[1]!.isMentioned).toBe(false)
    expect(cells[1]!.transition).toBe('non_mentionné')
    expect(cells[1]!.currentProvenState).toBe('open') // report
  })

  it('SENTINELLE Débroussaillage : 9 présences documentaires ≠ 9 événements d\'état', () => {
    // PV1 OPEN, PV2..3 présents sans occurrence, PV4 RESOLVED, PV5..9 présents sans occurrence.
    const runs = [
      prun('1', true, [occ('open')]),
      prun('2', true, []), prun('3', true, []),
      prun('4', true, [occ('resolved', 'knowledge_fact')]),
      prun('5', true, []), prun('6', true, []), prun('7', true, []), prun('8', true, []), prun('9', true, []),
    ]
    const cells = buildDocumentPresenceCells(runs)
    expect(cells.filter((c) => c && !c.isGap).length).toBe(9)                 // 9 cellules de présence
    expect(cells.filter((c) => c && c.observedTriState !== null).length).toBe(2) // 2 événements d'état (PV1, PV4)
    expect(cells.every((c) => c && !c.isGap)).toBe(true)                      // aucune fausse non-mention
    expect(cells[8]!.currentProvenState).toBe('resolved')                     // état porté de PV4 conservé jusqu'à PV9
  })

  it('présence AVANT la première occurrence → cellule de présence (démarre à la 1re présence)', () => {
    const cells = buildDocumentPresenceCells([prun('1', true, []), prun('2', true, [occ('open')])])
    expect(cells[0]!.isGap).toBe(false)
    expect(cells[0]!.isMentioned).toBe(true)
    expect(cells[0]!.observedTriState).toBeNull()
    expect(cells[1]!.observedTriState).toBe('open')
    expect(cells[1]!.transition).toBeNull() // première OCCURRENCE
  })
})
