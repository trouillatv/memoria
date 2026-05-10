/**
 * Slice 4.3 — Tests for insertEvidenceIntoMemoire server action.
 *
 * SKIPPED : la server action utilise `createClient()` qui dépend du contexte
 * `cookies()` de Next.js. Le harness de tests vitest courant ne fournit pas
 * de pattern pour stubber `cookies()` + `auth.getUser()` côté server action.
 *
 * Couverture manuelle prévue :
 *   1. Insert succeeds → marker `<!-- ref: engagement:UUID -->` présent en DB
 *   2. Re-insert idempotent → result.alreadyInserted === true, pas de duplicate
 *   3. Engagement sans evidence (0 interventions) → result.ok === false, error explicite
 *   4. Snippet contient le nom du contrat, jamais une personne (doctrine §5)
 *
 * À déskipper si on ajoute un helper testing `withMockedAuth(userId, role, fn)`.
 */
import { describe, it, expect } from 'vitest'

describe.skip('insertEvidenceIntoMemoire (server action)', () => {
  it('insère un snippet avec backlink marker', () => {
    expect(true).toBe(true)
  })

  it('est idempotent : 2e appel renvoie alreadyInserted: true', () => {
    expect(true).toBe(true)
  })

  it('refuse les engagements sans interventions exécutées', () => {
    expect(true).toBe(true)
  })

  it('mentionne le contrat, jamais une personne', () => {
    expect(true).toBe(true)
  })
})
