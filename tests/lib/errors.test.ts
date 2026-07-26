import { describe, expect, it } from 'vitest'
import { readableError } from '@/lib/errors'

describe('readableError', () => {
  it('extrait le message d\'une vraie Error', () => {
    expect(readableError(new Error('boom'))).toBe('boom')
  })

  it('n\'affiche JAMAIS « [object Object] » pour une erreur Supabase/Postgrest', () => {
    const supabaseError = {
      message: 'duplicate key value violates unique constraint "engagements_pkey"',
      details: 'Key (id)=(abc) already exists.',
      hint: null,
      code: '23505',
    }
    const out = readableError(supabaseError)
    expect(out).not.toContain('[object Object]')
    expect(out).toContain('duplicate key value')
    expect(out).toContain('23505')
  })

  it('objet sans champ connu → JSON, jamais « [object Object] »', () => {
    const out = readableError({ weird: true })
    expect(out).not.toContain('[object Object]')
    expect(out).toContain('weird')
  })

  it('valeurs primitives', () => {
    expect(readableError('texte brut')).toBe('texte brut')
    expect(readableError(42)).toBe('42')
    expect(readableError(null)).toBe('null')
  })
})
