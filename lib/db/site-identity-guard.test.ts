import { describe, it, expect } from 'vitest'
import { normalizeEstablishmentLabel, isSiteEstablishmentLabel } from './site-identity-guard'

// #232 — le garde doit bloquer EXACTEMENT le nom de l'établissement, JAMAIS une vraie
// entreprise au nom proche. Contre-exemples = vrais acteurs des PV Bella (aucun ne doit
// disparaître) + quasi-homonymes (ne doivent pas être avalés).

const BELLA_ALIASES = ['BELLA NAPOLI', 'bella napoli'] // sites.name + sites.normalized_name

describe('normalizeEstablishmentLabel', () => {
  it('minuscule, sans accents, alphanumérique, espaces réduits', () => {
    expect(normalizeEstablishmentLabel('  BELLA   NAPOLI  ')).toBe('bella napoli')
    expect(normalizeEstablishmentLabel('Bureau Véritas')).toBe('bureau veritas')
    expect(normalizeEstablishmentLabel('VHZ réfrigération')).toBe('vhz refrigeration')
  })
})

describe('isSiteEstablishmentLabel — bloque le site lui-même', () => {
  it('le nom exact de l\'établissement est reconnu (casse/espaces indifférents)', () => {
    expect(isSiteEstablishmentLabel('BELLA NAPOLI', BELLA_ALIASES)).toBe(true)
    expect(isSiteEstablishmentLabel('Bella Napoli', BELLA_ALIASES)).toBe(true)
    expect(isSiteEstablishmentLabel('  bella   napoli ', BELLA_ALIASES)).toBe(true)
  })
})

describe('isSiteEstablishmentLabel — NE supprime PAS de vrais acteurs (contre-exemples réels du PV)', () => {
  // Acteurs person/company réellement extraits des PV Bella 2024/2025.
  const REAL_ACTORS = [
    'Maeva LOMBARDI', 'Bureau Véritas', 'MIES', 'SACD (GBH)', 'KFT', 'CAPSE NC',
    'David BOUVIER', 'Velayoudon', 'Catherine DELORME', 'Hugo CANEPA', 'VHZ réfrigération',
    'Débora PROVENZANO', 'Glen DEMARQUET', 'Stéphane LACHOQUE', 'DSCGR',
  ]
  it('aucun vrai acteur n\'est confondu avec l\'établissement', () => {
    for (const a of REAL_ACTORS) {
      expect(isSiteEstablishmentLabel(a, BELLA_ALIASES)).toBe(false)
    }
  })
  it('quasi-homonymes NON avalés (égalité stricte, pas containment)', () => {
    expect(isSiteEstablishmentLabel('Bella Napoli Traiteur', BELLA_ALIASES)).toBe(false)
    expect(isSiteEstablishmentLabel('Pizzeria Bella Napoli', BELLA_ALIASES)).toBe(false)
    expect(isSiteEstablishmentLabel('BELLA NAPOLI SARL', BELLA_ALIASES)).toBe(false)
    expect(isSiteEstablishmentLabel('Napoli', BELLA_ALIASES)).toBe(false)
  })
})

describe('isSiteEstablishmentLabel — sécurité', () => {
  it('label vide / trop court / alias vides → jamais de match', () => {
    expect(isSiteEstablishmentLabel('', BELLA_ALIASES)).toBe(false)
    expect(isSiteEstablishmentLabel('X', BELLA_ALIASES)).toBe(false)
    expect(isSiteEstablishmentLabel('BELLA NAPOLI', [])).toBe(false)
    expect(isSiteEstablishmentLabel('BELLA NAPOLI', [null, undefined, ''])).toBe(false)
  })
  it('scoped au site : un autre site ne bloque pas « BELLA NAPOLI »', () => {
    expect(isSiteEstablishmentLabel('BELLA NAPOLI', ['OCEF Compostage', 'ocef compostage'])).toBe(false)
  })
})
