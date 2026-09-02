import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Point 7B-2 — propagation de l'identité canonique à la promotion. Si la
// proposition porte canonical_subject_id, l'objet créé l'hérite TEL QUEL ; aucun
// re-matching par libellé ne peut le remplacer. Si la proposition n'a pas de
// canonical, on n'invente rien (null). Lecture de source (server modules).

const attach = readFileSync(join(process.cwd(), 'lib/db/canonical-business-object-attach.ts'), 'utf8')
const actions = readFileSync(join(process.cwd(), 'lib/db/site-actions.ts'), 'utf8')
const deadlines = readFileSync(join(process.cwd(), 'lib/db/site-deadlines.ts'), 'utf8')
const proposals = readFileSync(join(process.cwd(), 'lib/db/knowledge-proposals.ts'), 'utf8')

describe('7B-2 — le helper accepte une identité EXPLICITE et n’applique alors aucun libellé', () => {
  it('resolveSubjectAndAttachCanonicalBusinessObject a un param knownCanonicalSubjectId', () => {
    expect(attach).toMatch(/knownCanonicalSubjectId\?: string \| null/)
  })
  it('quand knownCanonicalSubjectId est fourni, la résolution par libellé est court-circuitée', () => {
    expect(attach).toMatch(/params\.knownCanonicalSubjectId\s*\?\s*params\.knownCanonicalSubjectId\s*:\s*await resolveManualObjectCanonicalSubjectId/)
  })
})

describe('7B-2 — les créateurs posent l’identité explicite à l’insert et la passent au helper', () => {
  it('createSiteAction : param canonicalSubjectId, posé à l’insert + transmis en knownCanonicalSubjectId', () => {
    expect(actions).toMatch(/canonicalSubjectId\?: string \| null/)
    expect(actions).toMatch(/canonical_subject_id: input\.canonicalSubjectId \?\? null/)
    expect(actions).toMatch(/knownCanonicalSubjectId: input\.canonicalSubjectId \?\? null/)
  })
  it('createSiteDeadline : idem', () => {
    expect(deadlines).toMatch(/canonicalSubjectId\?: string \| null/)
    expect(deadlines).toMatch(/canonical_subject_id: input\.canonicalSubjectId \?\? null/)
    expect(deadlines).toMatch(/knownCanonicalSubjectId: input\.canonicalSubjectId \?\? null/)
  })
})

describe('7B-2 — la promotion propage l’identité de la proposition, jamais inventée', () => {
  it('promoteProposal passe p.canonical_subject_id (?? null) aux deux créateurs', () => {
    // action ET échéance
    const occurrences = proposals.match(/canonicalSubjectId: p\.canonical_subject_id \?\? null/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })
})
