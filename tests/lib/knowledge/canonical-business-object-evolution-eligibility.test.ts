// P0 — DELETED HISTORICAL SOURCE (2026-09-17).
//
// Ce test verrouille la fuite relue dans canonical-business-object-evolution.ts :
// filtrer seulement la date documentaire ne suffit pas. Un membre site_action issu
// d'un document supprimé ne doit plus alimenter ni doc_open, ni journal natif, ni
// targetActionId.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(): string {
  return readFileSync(join(process.cwd(), 'lib/knowledge/canonical-business-object-evolution.ts'), 'utf8')
}

describe('canonical-business-object-evolution — source supprimée inéligible', () => {
  it('exclut les membres CBO action supprimés avant members, natives et targetActionId', () => {
    const s = source()

    expect(s).toMatch(/const isMemberSourceDeleted = \(memberId: string\): boolean => \{/)
    expect(s).toMatch(/const eligibleMemberIds = memberIds\.filter\(\(memberId\) => !isMemberSourceDeleted\(memberId\)\)/)
    expect(s).toMatch(/const members: CboMemberProvenance\[\] = eligibleMemberIds\.map/)
    expect(s).toMatch(/const natives: CboNativeJournalEvent\[\] = eligibleMemberIds\.flatMap/)
    expect(s).toMatch(/const liveMembers = eligibleMemberIds\.filter\(\(m\) => actionInfo\.has\(m\)\)/)
  })

  it('applique la même exclusion aux CBO réserve/échéance', () => {
    const s = source()
    const nonActionSection = s.slice(s.indexOf('async function loadNonActionCboReducedStatesUncached'))

    expect(nonActionSection).toMatch(/const isMemberSourceDeleted = \(memberId: string\): boolean => \{/)
    expect(nonActionSection).toMatch(/const eligibleMemberIds = memberIds\.filter\(\(memberId\) => !isMemberSourceDeleted\(memberId\)\)/)
    expect(nonActionSection).toMatch(/const members: CboMemberProvenance\[\] = eligibleMemberIds\.map/)
  })
})
