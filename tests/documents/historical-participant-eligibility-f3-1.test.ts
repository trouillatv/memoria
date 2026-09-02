import { describe, it, expect } from 'vitest'
import { eligibleHistoricalPersonParticipant as elig } from '@/lib/documents/historical-participant-eligibility'

// Lot F3-1 — règle PURE d'éligibilité person → participant | null.
// Une personne détectée n'est un participant QUE sur preuve explicite de lien à
// l'événement. Le verdict F1 (statusAtDocumentDate) fait foi ; le rôle ne décide
// jamais. « inconnu » (interlocuteur/rôle/mention normalisés par F1) → null.

describe('F3-1 — preuve de présence/absence → participant', () => {
  it('1. présent prouvé → participant P', () => {
    const r = elig({ label: 'David BOUVIER', presenceVerdict: 'présent' })
    expect(r).not.toBeNull()
    expect(r!.presence).toBe('P'); expect(r!.invite).toBe(false); expect(r!.diffusion).toBe(false)
  })
  it('2. absent excusé → AE', () => {
    expect(elig({ label: 'X', presenceVerdict: 'absent excusé' })!.presence).toBe('AE')
  })
  it('3. absent non excusé → AN', () => {
    expect(elig({ label: 'X', presenceVerdict: 'absent non excusé' })!.presence).toBe('AN')
  })
})

describe('F3-1 — invité / diffusion → participant SANS présence', () => {
  it('4. invité → participant, invite=true, présence non renseignée', () => {
    const r = elig({ label: 'X', presenceVerdict: 'invité' })!
    expect(r.invite).toBe(true); expect(r.presence).toBeUndefined(); expect(r.diffusion).toBe(false)
  })
  it('5. diffusion uniquement → participant, diffusion=true, présence non renseignée', () => {
    const r = elig({ label: 'X', presenceVerdict: 'diffusion uniquement' })!
    expect(r.diffusion).toBe(true); expect(r.presence).toBeUndefined(); expect(r.invite).toBe(false)
  })
})

describe('F3-1 — personne détectée ≠ participant (preuve insuffisante → null)', () => {
  it('6. interlocuteur seul (→ inconnu sous F1) → null', () => {
    expect(elig({ label: 'David BOUVIER', description: 'Interlocuteur — CAPSE NC', presenceVerdict: 'inconnu' })).toBeNull()
  })
  it('7. rôle seul (RUS) → null', () => {
    expect(elig({ label: 'X', description: 'RUS — CAPSE NC', presenceVerdict: 'inconnu' })).toBeNull()
  })
  it('8. simple mention → null', () => {
    expect(elig({ label: 'X', description: "Mentionnée dans l'en-tête", presenceVerdict: 'inconnu' })).toBeNull()
  })
  it('9. unknown / non déterminé / vide / null → null', () => {
    expect(elig({ label: 'X', presenceVerdict: 'inconnu' })).toBeNull()
    expect(elig({ label: 'X', presenceVerdict: 'non déterminé' })).toBeNull()
    expect(elig({ label: 'X', presenceVerdict: '' })).toBeNull()
    expect(elig({ label: 'X', presenceVerdict: null })).toBeNull()
    expect(elig({ label: 'X' })).toBeNull()
  })
  it('10. entreprise / rôle organisationnel seul → null', () => {
    expect(elig({ label: 'X', description: 'Maître d\'œuvre — BECIB', presenceVerdict: 'inconnu' })).toBeNull()
  })
})

describe('F3-1 — le rôle ne décide jamais ; l’ambiguïté est rejetée', () => {
  it('11. présence prouvée + rôle → participation conservée, rôle porté mais non décisif', () => {
    const r = elig({ label: 'Mme ROUSSEL', description: 'Conducteur de travaux — OCEF', presenceVerdict: 'présent' })!
    expect(r.presence).toBe('P')       // la présence décide
    expect(r.role).toBe('Conducteur de travaux') // le rôle est conservé, pas décisif
  })
  it('12. verdict ambigu / non reconnu → null (jamais présumé présent)', () => {
    expect(elig({ label: 'X', presenceVerdict: 'peut-être' })).toBeNull()
    expect(elig({ label: 'X', presenceVerdict: 'contact' })).toBeNull()
    expect(elig({ label: 'X', presenceVerdict: 'C' })).toBeNull()
  })
})
