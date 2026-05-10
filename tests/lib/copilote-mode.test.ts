import { describe, it, expect } from 'vitest'
import { resolveMode, modeLabel, modeCta } from '@/app/(dashboard)/tenders/[id]/copilote-mode'

describe('resolveMode', () => {
  it('returns empty for 0 agents', () => {
    expect(resolveMode([])).toBe('empty')
  })
  it('returns expert for 1 agent', () => {
    expect(resolveMode(['contradicteur'])).toBe('expert')
  })
  it('returns debate for 2 agents', () => {
    expect(resolveMode(['contradicteur', 'financier'])).toBe('debate')
  })
  it('returns debate for 3 agents', () => {
    expect(resolveMode(['contradicteur', 'financier', 'terrain'])).toBe('debate')
  })
  it('throws if more than 3 agents', () => {
    expect(() => resolveMode(['a', 'b', 'c', 'd'] as never)).toThrow(/max 3/i)
  })
})

describe('modeLabel', () => {
  it('returns labels per mode', () => {
    expect(modeLabel('empty')).toBe('Choisissez un ou plusieurs experts')
    expect(modeLabel('expert')).toBe("Avis d'expert")
    expect(modeLabel('debate')).toBe('Débat IA')
  })
})

describe('modeCta', () => {
  it('returns CTAs per mode', () => {
    expect(modeCta('empty')).toBe("Sélectionnez d'abord un expert")
    expect(modeCta('expert')).toBe('Demander un avis')
    expect(modeCta('debate')).toBe('Lancer le débat IA')
  })
})
