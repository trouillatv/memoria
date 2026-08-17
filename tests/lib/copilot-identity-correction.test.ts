import { describe, it, expect } from 'vitest'
import { extractIdentityCorrection } from '@/lib/visits/copilot-identity-correction'

describe('extractIdentityCorrection — 3 formes (spec Vincent, P4-B.2)', () => {
  it('"Quand je dis Clim Expert, je parle de Clim Expair." → transcription_alias', () => {
    const result = extractIdentityCorrection('Quand je dis Clim Expert, je parle de Clim Expair.')
    expect(result).toEqual({
      alias: 'Clim Expert',
      target: 'Clim Expair',
      targetOrg: null,
      proposedNature: 'transcription_alias',
    })
  })

  it('"Jérôme, c\'est Jérôme Martin de BECIB." → business_alias avec org', () => {
    const result = extractIdentityCorrection("Jérôme, c'est Jérôme Martin de BECIB.")
    expect(result).toEqual({
      alias: 'Jérôme',
      target: 'Jérôme Martin',
      targetOrg: 'BECIB',
      proposedNature: 'business_alias',
    })
  })

  it('"Non, Vincent Millon c\'est Vincent Milon." → transcription_alias', () => {
    const result = extractIdentityCorrection("Non, Vincent Millon c'est Vincent Milon.")
    expect(result).toEqual({
      alias: 'Vincent Millon',
      target: 'Vincent Milon',
      targetOrg: null,
      proposedNature: 'transcription_alias',
    })
  })

  it('phrase sans forme reconnue → null', () => {
    expect(extractIdentityCorrection('Où en est le portail ?')).toBeNull()
  })

  it('"On appelle aussi Clim Expair, Climatisation Expair." → business_alias, target=1er segment', () => {
    const result = extractIdentityCorrection('On appelle aussi Clim Expair, Climatisation Expair.')
    expect(result).toEqual({
      alias: 'Climatisation Expair',
      target: 'Clim Expair',
      targetOrg: null,
      proposedNature: 'business_alias',
    })
  })

  it('"Clim Expair, c\'est Climatisation Expair." (forme nue) → business_alias, alias=1er segment', () => {
    const result = extractIdentityCorrection("Clim Expair, c'est Climatisation Expair.")
    expect(result).toEqual({
      alias: 'Clim Expair',
      target: 'Climatisation Expair',
      targetOrg: null,
      proposedNature: 'business_alias',
    })
  })

  it('forme nue "X, c\'est Y de Z" reste captée par DE_RE (avec org), pas par la forme nue', () => {
    const result = extractIdentityCorrection("Jérôme, c'est Jérôme Martin de BECIB.")
    expect(result?.proposedNature).toBe('business_alias')
    expect(result?.targetOrg).toBe('BECIB')
  })
})
