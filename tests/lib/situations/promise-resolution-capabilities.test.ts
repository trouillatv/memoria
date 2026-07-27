// T4 — les capacités de résolution apparaissent sur une promesse (qui porte un
// subject) et traversent jusqu'à la carte Attention, SANS jamais afficher
// « Confirmer » (réservé à la validation/promotion) et sans faire entrer la
// promesse dans Now.

import { describe, expect, it } from 'vitest'
import type { StructuredPromiseRecord } from '@/lib/memory/signals/promise-candidates'
import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import { presentSituation } from '@/lib/situations/presenter'
import { projectSituationForAttention } from '@/lib/situations/attention/project'
import { projectSituationForNow } from '@/lib/situations/now/project'

const NOW = '2026-07-28T08:00:00.000Z'
const source = { type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite' }
const subject: PromiseSubjectRef = { table: 'captured_knowledge', id: 'p-1', organizationId: 'org-1', siteId: 'site-1' }

function promiseSituation() {
  const record: StructuredPromiseRecord = {
    id: 'p-1', organizationId: 'org-1', siteId: 'site-1', siteName: 'Lycée PETRO ATTITI', kind: 'promise',
    title: 'Le planning sera diffusé vendredi.', body: null, source, subject,
    occurredAt: '2026-07-21T09:00:00.000Z', dueAt: '2026-07-25T23:59:59+11:00',
    confirmedAt: null, confirmationSourceIds: [], relatedProofSourceIds: [], importance: 'normal', blocking: false,
  }
  const [signal] = detectPromiseSignalsFromRecords([record], NOW)
  return presentSituation(signal, NOW)!
}

describe('T4 — capacités de résolution', () => {
  it('le presenter expose open_source + les 4 gestes de résolution, jamais « Confirmer »', () => {
    const s = promiseSituation()
    expect(s.capabilities.map((c) => c.kind)).toEqual([
      'open_source', 'fulfill_promise', 'cancel_promise', 'replace_promise', 'create_follow_up_action',
    ])
    const labels = s.capabilities.map((c) => c.label)
    expect(labels).toContain('Marquer comme réalisée')
    expect(labels).not.toContain('Confirmer')
  })

  it('la carte Attention porte subject + resolutions ; open_source reste un LIEN', () => {
    const card = projectSituationForAttention(promiseSituation())!
    expect(card.subject).toEqual(subject)
    expect(card.resolutions.map((r) => r.kind)).toEqual([
      'fulfill_promise', 'cancel_promise', 'replace_promise', 'create_follow_up_action',
    ])
    expect(card.primaryAction?.kind).toBe('open_source')
    // Les résolutions ne contiennent jamais open_source.
    expect(card.resolutions.some((r) => r.kind === 'open_source' as never)).toBe(false)
  })

  it('malgré ses capacités, une promesse N’ENTRE PAS dans Now (règle non définie)', () => {
    expect(projectSituationForNow(promiseSituation())).toBeNull()
  })
})
