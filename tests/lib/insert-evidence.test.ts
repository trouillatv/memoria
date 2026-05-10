/**
 * Slice 4.3 — Tests for insertEvidenceIntoMemoire server action.
 *
 * SKIPPED (dette tracée — décision Slice 4.4) : la server action utilise
 * `createClient()` from `@/lib/supabase/server` qui dépend du contexte
 * `cookies()` de Next.js, PLUS la chaîne fluente Supabase (.from().select().eq()
 * .order().limit().maybeSingle()) qu'il faudrait stubber bout en bout. Le
 * harness vitest n'a pas de pattern existant ; un mock exhaustif serait
 * fragile (chaque branche du SDK Supabase à mocker).
 *
 * Couverture programmatique alternative : `scripts/phase4-smoke.ts` (E2E DB
 * réelle sur le tender démo Sainte-Marie). La server action elle-même est
 * couverte par le test manuel du parcours en démo.
 *
 * Couverture attendue (à coder si on introduit un helper `withMockedSupabase`) :
 *   1. Insert succeeds → marker `<!-- ref: engagement:UUID -->` présent en DB
 *   2. Re-insert idempotent → result.alreadyInserted === true, pas de duplicate
 *   3. Engagement sans evidence (0 interventions) → result.ok === false, error explicite
 *   4. Snippet contient le nom du contrat, jamais une personne (doctrine §5)
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
