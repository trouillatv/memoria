import { describe, expect, it } from 'vitest'
import { buildPromiseCandidates, type StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'

const source = { type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite du 21 juillet' }

const record = (overrides: Partial<StructuredPromiseRecord> = {}): StructuredPromiseRecord => ({
  id: 'promise-1', organizationId: 'org-1', siteId: 'site-1', siteName: 'Lycée PETRO ATTITI', kind: 'promise',
  title: 'Le planning sera diffusé vendredi.', body: null, source,
  subject: { table: 'captured_knowledge', id: 'promise-1', organizationId: 'org-1', siteId: 'site-1' },
  occurredAt: '2026-07-21T09:00:00.000Z',
  dueAt: '2026-07-25T23:59:59+11:00', confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [],
  importance: 'normal', blocking: false, ...overrides,
})

describe('PromiseCandidateBuilder', () => {
  it('construit un candidat stable uniquement depuis une promesse structurée', () => {
    expect(buildPromiseCandidates([record()])).toEqual([expect.objectContaining({
      id: 'promise-1', text: 'Le planning sera diffusé vendredi.', dueAt: '2026-07-25T23:59:59+11:00',
      organizationId: 'org-1', siteId: 'site-1',
    })])
  })

  it('ignore les dates civiles ambiguës et les lignes qui ne sont pas des promesses', () => {
    expect(buildPromiseCandidates([record({ dueAt: '2026-07-25' })])).toHaveLength(0)
    expect(buildPromiseCandidates([record({ kind: 'question' })])).toHaveLength(0)
  })

  it('construit un candidat sans échéance pour une promesse explicitement qualifiée', () => {
    expect(buildPromiseCandidates([record({ dueAt: null })])).toEqual([expect.objectContaining({
      id: 'promise-1', text: 'Le planning sera diffusé vendredi.', dueAt: null,
    })])
  })

  it('n’interprète pas le texte pour fabriquer une échéance', () => {
    expect(buildPromiseCandidates([record({ dueAt: null, body: 'vendredi prochain' })])).toEqual([expect.objectContaining({
      dueAt: null,
    })])
  })

  it('ignore une date fournie qui est invalide ou sans fuseau', () => {
    expect(buildPromiseCandidates([record({ dueAt: '2026-07-25T23:59:59' })])).toHaveLength(0)
    expect(buildPromiseCandidates([record({ dueAt: 'not-a-date' })])).toHaveLength(0)
  })

  it('ne crée pas un nouvel identifiant quand la même ligne est répétée', () => {
    expect(buildPromiseCandidates([record(), record({ title: 'Planning diffusé vendredi.' })])).toHaveLength(1)
  })
})
