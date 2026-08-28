import { describe, it, expect } from 'vitest'
import { buildOccurrenceCells, type RunOccurrence } from '@/lib/documents/site-occurrence-timeline'

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
