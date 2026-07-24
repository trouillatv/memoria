import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inbox = readFileSync(join(process.cwd(), 'app/(field)/m/site/[siteId]/MemoryReviewPanel.tsx'), 'utf8')
const dashboard = readFileSync(join(process.cwd(), 'app/(dashboard)/dashboard/DashboardPremium.tsx'), 'utf8')
const siteMemory = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/views/memoire/MemoireConfirmer.tsx'), 'utf8')

describe('proposal workflow parity', () => {
  it('keeps the stakeholder workflow complete in the shared card', () => {
    expect(inbox).toContain('Nouvel intervenant')
    expect(inbox).toContain('Rattacher')
    expect(inbox).toContain('Écarter')
    expect(inbox).toContain('searchIntervenantTargetsAction')
    expect(inbox).toContain('company_id')
  })

  it('uses the same interactive inbox in the dashboard and site memory view', () => {
    expect(dashboard).toContain("import { MemoryInbox } from '@/app/(field)/m/site/[siteId]/MemoryReviewPanel'")
    expect(siteMemory).toContain("import { MemoryInbox } from '@/app/(field)/m/site/[siteId]/MemoryReviewPanel'")
  })
})
