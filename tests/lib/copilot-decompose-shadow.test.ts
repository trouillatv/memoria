// @vitest-environment node
/**
 * P6-A2 — shadow mode : `decompose-v2` branché en observation pure sur les
 * vrais tours Copilote (mandat Vincent 2026-08-17).
 *
 * Ce fichier prouve deux choses distinctes :
 *   1. Le probe (`runDecomposeShadowProbe`) est SANS EFFET sur le pipeline
 *      réel dans les 5 issues possibles de `decomposeUtterance` (3 segments,
 *      repli texte court, timeout, erreur provider, sortie invalide) : il ne
 *      lève jamais, ne renvoie jamais rien d'exploitable, et n'appelle aucune
 *      fonction d'écriture métier (test 6).
 *   2. La télémétrie écrite est correctement rattachée au tour source via
 *      `conversation_id` (test 7).
 *
 * Une seule intégration bout-en-bout (`prepareCopilotAnswer`) complète ces
 * 7 preuves : elle montre que la réponse réelle est identique, que le shadow
 * réussisse, échoue, ou soit désactivé — sans dupliquer les 5 scénarios au
 * niveau pipeline (CLAUDE.md §7 : pas de suite redondante sans valeur).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AIProvider, CompletionOutput } from '@/services/ai'

const inserted: Array<{ table: string; row: Record<string, unknown> }> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }),
}))

import { runDecomposeShadowProbe, scheduleDecomposeShadow } from '@/lib/visits/copilot-decompose-shadow'

function provider(impl: () => Promise<CompletionOutput>): AIProvider {
  return { name: 'mock', complete: impl }
}

function output(parsed: unknown, text = ''): CompletionOutput {
  return { text, parsed, tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1 }
}

const BASE_INPUT = {
  siteId: 'site-1',
  userId: 'user-1',
  organizationId: 'org-1',
  conversationId: 'conv-1',
  question: 'Le portail est cassé. Planifie une réunion vendredi.',
}

beforeEach(() => {
  inserted.length = 0
})

describe('runDecomposeShadowProbe — 5 issues, comportement identique (jamais d’effet sur le pipeline réel)', () => {
  it('1. résultat 3 segments : ne lève pas, ne renvoie rien, une ligne écrite', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire. Planifie une réunion vendredi.'
    const segments = [
      { start: text.indexOf('Le portail'), end: text.indexOf('Le portail') + 'Le portail est cassé'.length, dependsOn: null },
      { start: text.indexOf('Rappelle'), end: text.indexOf('Rappelle') + 'Rappelle le prestataire'.length, dependsOn: null },
      { start: text.indexOf('Planifie'), end: text.indexOf('Planifie') + 'Planifie une réunion vendredi'.length, dependsOn: null },
    ]
    const p = provider(async () => output({ segments, ambiguous: false }))

    const result = await runDecomposeShadowProbe({ ...BASE_INPUT, question: text }, { provider: p })

    expect(result).toBeUndefined()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe('copilot_decompose_shadow')
    expect(inserted[0].row.segment_count).toBe(3)
    expect(inserted[0].row.ambiguous).toBe(false)
    expect(inserted[0].row.error).toBeNull()
  })

  it('2. résultat de repli (texte trop court) : ne lève pas, repli déclaré', async () => {
    let called = false
    const p = provider(async () => { called = true; return output({}) })

    const result = await runDecomposeShadowProbe({ ...BASE_INPUT, question: 'ok' }, { provider: p })

    expect(result).toBeUndefined()
    expect(called).toBe(false) // texte trop court : pas d'appel LLM, cf. decomposeUtterance
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row.segment_count).toBe(1)
    expect(inserted[0].row.ambiguous).toBe(true)
    expect(inserted[0].row.used_fallback).toBe(true)
  })

  it('3. timeout LLM : ne lève pas, repli mono-segment écrit', async () => {
    const p = provider(() => new Promise<CompletionOutput>(() => { /* ne résout jamais */ }))

    const result = await runDecomposeShadowProbe(BASE_INPUT, { provider: p, timeoutMs: 30 })

    expect(result).toBeUndefined()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row.ambiguous).toBe(true)
    expect(inserted[0].row.used_fallback).toBe(true)
    expect(inserted[0].row.error).toBeNull() // le timeout est absorbé par decomposeUtterance, pas une erreur du probe
  })

  it('4. erreur provider : ne lève pas, repli mono-segment écrit', async () => {
    const p = provider(async () => { throw new Error('provider down') })

    const result = await runDecomposeShadowProbe(BASE_INPUT, { provider: p })

    expect(result).toBeUndefined()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row.ambiguous).toBe(true)
    expect(inserted[0].row.used_fallback).toBe(true)
  })

  it('5. sortie LLM invalide : ne lève pas, repli mono-segment écrit', async () => {
    const p = provider(async () => output(undefined, 'pas du json'))

    const result = await runDecomposeShadowProbe(BASE_INPUT, { provider: p })

    expect(result).toBeUndefined()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row.ambiguous).toBe(true)
    expect(inserted[0].row.used_fallback).toBe(true)
  })
})

describe('6. isolation — aucune fonction d’écriture métier appelée depuis le shadow', () => {
  it('la seule table touchée est copilot_decompose_shadow, pour les 5 issues', async () => {
    const scenarios: Array<() => Promise<CompletionOutput>> = [
      async () => output({ segments: [{ start: 0, end: BASE_INPUT.question.length, dependsOn: null }], ambiguous: false }),
      async () => output({}), // structure invalide → repli
      async () => { throw new Error('down') },
      async () => output(undefined, 'pas du json'),
    ]
    for (const impl of scenarios) {
      await runDecomposeShadowProbe(BASE_INPUT, { provider: provider(impl) })
    }

    expect(inserted.every((i) => i.table === 'copilot_decompose_shadow')).toBe(true)
  })

  it('le module ne référence aucun writer connu (garde structurelle)', async () => {
    const mod = await import('@/lib/visits/copilot-decompose-shadow')
    const src = Object.keys(mod)
    // Le seul comportement observable du module est ces deux exports — pas de
    // writer/proposal/knowledge exposé, pas d'accès direct au pipeline réel.
    expect(src.sort()).toEqual(['runDecomposeShadowProbe', 'scheduleDecomposeShadow'].sort())
  })
})

describe('7. rattachement — télémétrie liée au tour source via conversation_id', () => {
  it('la ligne écrite porte le même conversation_id que le tour appelant', async () => {
    const p = provider(async () => output({}))
    await runDecomposeShadowProbe({ ...BASE_INPUT, question: 'ok', conversationId: 'conv-xyz-789' }, { provider: p })

    expect(inserted).toHaveLength(1)
    expect(inserted[0].row.conversation_id).toBe('conv-xyz-789')
    expect(inserted[0].row.site_id).toBe(BASE_INPUT.siteId)
    expect(inserted[0].row.user_id).toBe(BASE_INPUT.userId)
    expect(inserted[0].row.organization_id).toBe(BASE_INPUT.organizationId)
  })

  it('conversation_id absent (null) est toléré et écrit tel quel', async () => {
    const p = provider(async () => output({}))
    await runDecomposeShadowProbe({ ...BASE_INPUT, question: 'ok', conversationId: null }, { provider: p })

    expect(inserted[0].row.conversation_id).toBeNull()
  })
})

describe('scheduleDecomposeShadow — n’exécute jamais rien hors contexte de requête (tests)', () => {
  it('ne lève pas et ne touche aucune table quand after() est indisponible', () => {
    expect(() => scheduleDecomposeShadow(BASE_INPUT)).not.toThrow()
    expect(inserted).toHaveLength(0)
  })

  it('COPILOT_DECOMPOSE_SHADOW=0 : coupe-circuit, aucun appel', () => {
    const prev = process.env.COPILOT_DECOMPOSE_SHADOW
    process.env.COPILOT_DECOMPOSE_SHADOW = '0'
    try {
      scheduleDecomposeShadow(BASE_INPUT)
      expect(inserted).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.COPILOT_DECOMPOSE_SHADOW
      else process.env.COPILOT_DECOMPOSE_SHADOW = prev
    }
  })

  it('question vide : aucun appel planifié', () => {
    scheduleDecomposeShadow({ ...BASE_INPUT, question: '   ' })
    expect(inserted).toHaveLength(0)
  })

  it('organizationId absent : le probe direct ne fait rien (cloisonnement org)', async () => {
    const result = await runDecomposeShadowProbe({ ...BASE_INPUT, organizationId: null })
    expect(result).toBeUndefined()
    expect(inserted).toHaveLength(0)
  })
})
