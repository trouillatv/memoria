import { describe, it, expect } from 'vitest'
import { MockProvider } from '@/services/ai/providers/mock'

describe('MockProvider', () => {
  it('parse __MOCK_FIXTURE__ correctement', async () => {
    const p = new MockProvider()
    const fixture = { foo: 'bar', n: 42 }
    const r = await p.complete({
      systemPrompt: '',
      userMessage: '__MOCK_FIXTURE__:' + JSON.stringify(fixture),
      modelTier: 'light',
    })
    expect(r.parsed).toEqual(fixture)
    expect(r.tokens.input).toBeGreaterThan(0)
    expect(r.tokens.output).toBeGreaterThan(0)
    expect(r.model).toBe('mock-1')
  })

  it('fournit un fallback quand pas de fixture', async () => {
    const p = new MockProvider()
    const r = await p.complete({
      systemPrompt: '',
      userMessage: 'Free-form prompt without fixture',
      modelTier: 'light',
    })
    expect(r.parsed).toMatchObject({ _mock: true })
  })
})
