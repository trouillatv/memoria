import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isOperationalDeadline,
  OPERATIONAL_DEADLINE_SOURCE_FILTER,
} from '@/lib/db/deadline-projection'

const operationalReaders = [
  'lib/knowledge/site-attention-items.ts',
  'lib/knowledge/build-site-intelligence-context.ts',
  'lib/db/site-visit-brief.ts',
  'lib/knowledge/site-activity-read-model.ts',
  'lib/knowledge/site-graph.ts',
]

describe('projection opérationnelle des échéances', () => {
  it('conserve les échéances courantes et les lignes legacy NULL', () => {
    expect(isOperationalDeadline({ createdFrom: 'manual', status: 'planned' })).toBe(true)
    expect(isOperationalDeadline({ createdFrom: null, status: 'to_plan' })).toBe(true)
  })

  it('exclut les imports historiques et les mauvaises extractions annulées', () => {
    expect(isOperationalDeadline({ createdFrom: 'historical_import', status: 'planned' })).toBe(false)
    expect(isOperationalDeadline({ createdFrom: 'historical_import', status: 'cancelled' })).toBe(false)
    expect(isOperationalDeadline({ createdFrom: null, status: 'cancelled' })).toBe(false)
  })

  it('exprime explicitement la sémantique NULL de PostgREST', () => {
    expect(OPERATIONAL_DEADLINE_SOURCE_FILTER).toBe(
      'created_from.is.null,created_from.neq.historical_import',
    )
  })

  it.each(operationalReaders)('%s utilise le prédicat partagé', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8')
    expect(source).toContain('.or(OPERATIONAL_DEADLINE_SOURCE_FILTER)')
    expect(source).toContain("from '@/lib/db/deadline-projection'")
  })
})
