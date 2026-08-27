import { describe, it, expect } from 'vitest'
import { extractEventDate } from '@/lib/documents/event-date'

// P3-D2 — distinguer la date PROPRE d'un fait de la date du document. Réutilise detectDocumentDate.

describe('extractEventDate — cas obligatoires', () => {
  it('historique rappelé : « contrôlé … le 22/03/2024 » → 2024-03-22', () => {
    const r = extractEventDate(['Installations électriques contrôlées par Bureau Veritas le 22/03/2024'])
    expect(r.iso).toBe('2024-03-22')
    expect(r.ambiguous).toBe(false)
  })
  it('état constaté sans date propre : « à refaire immédiatement » → null (jamais la date du PV)', () => {
    expect(extractEventDate(['Contrôle de l’éclairage de sécurité à refaire immédiatement']).iso).toBeNull()
  })
  it('échéance : « à refaire avant novembre 2025 » → null (deadline, pas event_date)', () => {
    expect(extractEventDate(['Nettoyage des conduits à refaire avant novembre 2025']).iso).toBeNull()
  })
  it('date partielle « en 04/23 » (mois/année, sans jour) → null (reste textuelle)', () => {
    expect(extractEventDate(['Extincteurs contrôlés par MIES en 04/23']).iso).toBeNull()
  })
  it('témoin succès D2 : réalisé le 22/03/2024 vs à refaire → deux résultats distincts', () => {
    expect(extractEventDate(['Contrôle éclairage de sécurité réalisé le 22/03/2024 par Bureau Véritas']).iso).toBe('2024-03-22')
    expect(extractEventDate(['Contrôle éclairage de sécurité à refaire']).iso).toBeNull()
  })
})

describe('extractEventDate — robustesse', () => {
  it('textes vides / null → null', () => {
    expect(extractEventDate([]).iso).toBeNull()
    expect(extractEventDate([null, undefined, '']).iso).toBeNull()
  })
  it('la date peut venir de la description/preuve, pas seulement du label', () => {
    const r = extractEventDate(['Contrôle réalisé', 'Le contrôle a été réalisé le 22/03/2024 par Bureau Véritas.'])
    expect(r.iso).toBe('2024-03-22')
  })
  it('plusieurs dates événementielles distinctes proches → ambigu, iso=null (jamais la première)', () => {
    // Deux « réalisé le … » de même confiance → on ne tranche pas.
    const r = extractEventDate(['Contrôle réalisé le 22/03/2024', 'autre contrôle réalisé le 15/04/2024'])
    expect(r.ambiguous).toBe(true)
    expect(r.iso).toBeNull()
  })
  it('une seule date de visite (pas event) → null (on ne remonte que event_date)', () => {
    expect(extractEventDate(['Visite du 05/08/2025']).iso).toBeNull()
  })
})
