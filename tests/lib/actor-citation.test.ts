import { describe, it, expect } from 'vitest'
import { detectActorRelations, normalizeForCitation, type ActorSubject } from '@/lib/db/actor-citation'

// P1-C1b (workflow) — rôle d'un acteur cité dans un fait, lié à l'OCCURRENCE. Jamais le
// sujet, jamais responsible_for. Déterministe, frontières lexicales, alias normalisés.

const ACTORS: ActorSubject[] = [
  { id: 'kft', label: 'KFT' },
  { id: 'bv', label: 'Bureau Veritas', aliases: ['Bureau Véritas'] },
  { id: 'mies', label: 'MIES' },
  { id: 'dscgr', label: 'DSCGR' },
  { id: 'capse', label: 'CAPSE NC' },
  { id: 'vela', label: 'Velayoudon' },
  { id: 'vhz', label: 'VHZ réfrigération' },
  { id: 'apave', label: 'APAVE' }, // acteur du site NON cité dans les faits ci-dessous
]

function rel(texts: string[]) {
  return detectActorRelations(texts, ACTORS)
}

describe('detectActorRelations — 9 faits réels Bella Napoli (rôle attendu)', () => {
  const CASES: Array<{ name: string; texts: string[]; actor: string; type: string }> = [
    { name: 'KFT', actor: 'kft', type: 'performed_by', texts: ["Nettoyage des conduits d'extraction d'air vicié réalisé par KFT en 11/2022"] },
    { name: 'BV cuisson', actor: 'bv', type: 'performed_by', texts: ['Appareils de cuisson contrôlés par Bureau Veritas le 25/03/2022'] },
    { name: 'BV électrique', actor: 'bv', type: 'performed_by', texts: ['Installations électriques contrôlées par Bureau Veritas le 22/03/2024'] },
    { name: 'MIES friteuse', actor: 'mies', type: 'performed_by', texts: ["Système d'extinction automatique (friteuse) contrôlé par MIES en 11/2022"] },
    { name: 'MIES extincteurs', actor: 'mies', type: 'performed_by', texts: ['Extincteurs contrôlés par MIES en 04/23'] },
    { name: 'CAPSE', actor: 'capse', type: 'proposed_by', texts: ['Mise en place panneau', 'Proposition de CAPSE NC pour séparer les flux'] },
    { name: 'DSCGR', actor: 'dscgr', type: 'validated_with', texts: ['Validation issue mall', "Décision validée en 2023 avec la DSCGR concernant l'issue"] },
    { name: 'VHZ', actor: 'vhz', type: 'performed_by', texts: ['Contrôles climatisation réalisés', 'réalisés le 23/01/25 par VHZ réfrigération'] },
    { name: 'Velayoudon', actor: 'vela', type: 'performed_by', texts: ['Récupération des huiles usagées', 'récupérés chaque semaine par Velayoudon, pompés'] },
  ]
  for (const c of CASES) {
    it(`${c.name} → ${c.type}`, () => {
      const got = rel(c.texts)
      const found = got.find(r => r.actorId === c.actor)
      expect(found?.relationType).toBe(c.type)
      expect(got.some(r => r.actorId === 'apave')).toBe(false) // acteur non cité jamais lié
    })
  }
})

describe('detectActorRelations — garde-fous obligatoires', () => {
  it('1. « réalisé par X » → lien performed_by', () => {
    expect(rel(['Contrôle réalisé par MIES'])[0]).toMatchObject({ actorId: 'mies', relationType: 'performed_by' })
  })

  it('2. acteur cité AILLEURS dans le PV mais pas dans CE fait → aucun lien', () => {
    // Le texte passé est celui du fait ; KFT n'y est pas → pas de lien même si KFT est au PV.
    expect(rel(['Contrôle des extincteurs OK']).some(r => r.actorId === 'kft')).toBe(false)
  })

  it('3. plusieurs acteurs prouvés dans un même fait → plusieurs liens', () => {
    const got = rel(['Contrôlé par Bureau Veritas puis validé avec la DSCGR'])
    expect(got.map(r => r.actorId).sort()).toEqual(['bv', 'dscgr'])
  })

  it('4. acteur aliasé (Bureau Véritas) → même acteur canonique', () => {
    const got = rel(['Contrôlé par Bureau Véritas le 01/02'])
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ actorId: 'bv', relationType: 'performed_by' })
  })

  it('5. acronyme court → pas de faux positif par sous-chaîne (mie ⊄ mies)', () => {
    expect(detectActorRelations(['Système mies en place'], [{ id: 'mie', label: 'MIE' }])).toEqual([])
  })

  it('6. proposé par ≠ performed_by', () => {
    expect(rel(['Proposition de CAPSE NC'])[0].relationType).toBe('proposed_by')
    expect(rel(['Réalisé par CAPSE NC'])[0].relationType).toBe('performed_by')
  })

  it('7. validé avec ≠ responsabilité (jamais responsible_for)', () => {
    const got = rel(['Décision validée avec la DSCGR'])
    expect(got[0].relationType).toBe('validated_with')
    // le vocabulaire ne contient PAS responsible_for
    expect(['performed_by', 'proposed_by', 'validated_with', 'mentioned']).toContain(got[0].relationType)
  })

  it('rôle par défaut prudent = mentioned quand aucun indice', () => {
    expect(rel(['Intervention notée : KFT sur site'])[0]).toMatchObject({ actorId: 'kft', relationType: 'mentioned' })
  })

  it('généricité futur CR : « Vérification SSI réalisée par SOCOTEC » → performed_by', () => {
    const actors: ActorSubject[] = [{ id: 'soc', label: 'SOCOTEC' }]
    expect(detectActorRelations(['Vérification SSI réalisée par SOCOTEC le 12/01/2026'], actors)[0])
      .toMatchObject({ actorId: 'soc', relationType: 'performed_by' })
  })

  it('déterminisme/idempotence : même entrée → même sortie', () => {
    const a = rel(['Nettoyage réalisé par KFT'])
    const b = rel(['Nettoyage réalisé par KFT'])
    expect(a).toEqual(b)
  })

  it('normalizeForCitation borne d’espaces et retire diacritiques', () => {
    expect(normalizeForCitation('Réalisé par KFT')).toBe(' realise par kft ')
  })
})
