// File org « Acteurs à confirmer » — logique PURE de lecture d'une mention et de
// suggestion de rapprochement. Doctrine : une mention n'est pas une identité ; la
// suggestion se fait par nom normalisé, jamais de fusion automatique, et une
// mention-personne ne se rapproche JAMAIS d'une entreprise (ni l'inverse).

import { describe, expect, it } from 'vitest'
import { deriveMention, pickSuggestion, normalizeName } from '@/lib/db/actor-proposals'

describe('deriveMention', () => {
  it('« Jean Dupont (ETV) » → personne + entreprise séparées', () => {
    expect(deriveMention('Jean Dupont (ETV)')).toEqual({ personName: 'Jean Dupont', companyName: 'ETV', likelyPerson: true })
  })

  it('« Jean Dupont » → personne probable, sans entreprise devinée', () => {
    expect(deriveMention('Jean Dupont')).toEqual({ personName: null, companyName: null, likelyPerson: true })
  })

  it('« M. Dupont » → personne probable', () => {
    expect(deriveMention('M. Dupont').likelyPerson).toBe(true)
  })

  it('« Ginger » (un seul mot) → pas une personne probable', () => {
    expect(deriveMention('Ginger')).toEqual({ personName: null, companyName: null, likelyPerson: false })
  })

  it('forme juridique → entreprise (jamais personne)', () => {
    expect(deriveMention('SARL Petro Attiti').likelyPerson).toBe(false)
    expect(deriveMention('Bureau BET Structure').likelyPerson).toBe(false)
  })
})

describe('pickSuggestion', () => {
  const contacts = [
    { id: 'c1', name: 'Jean Dupont', companyName: 'ETV' },
    { id: 'c2', name: 'Yann Le Roux', companyName: null },
  ]
  const companies = [
    { id: 'co1', name: 'Ginger' },
    { id: 'co2', name: 'ETV' },
  ]

  it('mention-personne → rapproche un CONTACT par nom normalisé (accents/casse)', () => {
    const m = deriveMention('JEAN DÜPONT')
    const s = pickSuggestion({ ...m, title: 'JEAN DÜPONT' }, contacts, companies)
    expect(s).toEqual({ kind: 'contact', id: 'c1', name: 'Jean Dupont', companyName: 'ETV' })
  })

  it('« Jean Dupont (ETV) » → rapproche par le nom de PERSONNE, pas le titre entier', () => {
    const m = deriveMention('Jean Dupont (ETV)')
    const s = pickSuggestion({ ...m, title: 'Jean Dupont (ETV)' }, contacts, companies)
    expect(s?.kind).toBe('contact')
    expect(s?.id).toBe('c1')
  })

  it('mention-personne ne se rapproche JAMAIS d’une entreprise homonyme', () => {
    // « ETV » existe comme entreprise mais la mention est une personne inconnue.
    const m = { personName: 'ETV', companyName: null, likelyPerson: true }
    expect(pickSuggestion({ ...m, title: 'ETV' }, contacts, companies)).toBeNull()
  })

  it('mention-entreprise → rapproche une ENTREPRISE', () => {
    const m = deriveMention('Ginger')
    const s = pickSuggestion({ ...m, title: 'Ginger' }, contacts, companies)
    expect(s).toEqual({ kind: 'company', id: 'co1', name: 'Ginger', companyName: null })
  })

  it('aucun rapprochement sûr → null (jamais de fusion approximative)', () => {
    const m = deriveMention('Inconnu Total')
    expect(pickSuggestion({ ...m, title: 'Inconnu Total' }, contacts, companies)).toBeNull()
  })
})

describe('normalizeName', () => {
  it('insensible casse/accents/espaces', () => {
    expect(normalizeName('  JÉrôme  ')).toBe('jerome')
  })
})
