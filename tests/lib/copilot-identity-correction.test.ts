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
})
