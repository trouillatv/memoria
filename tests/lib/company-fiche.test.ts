// Lot 2B.3B — composition PURE de la fiche Entreprise. Vérifie que le VOLUME seul ne
// dégrade jamais l'état, le statut par chantier, et l'attention via politique commune.

import { describe, expect, it } from 'vitest'
import { buildCompanyFiche, type CompanyFicheInputs } from '@/lib/db/company-fiche'

function base(): CompanyFicheInputs {
  return {
    today: '2026-07-27',
    company: { id: 'co1', name: 'SOTRAP SARL', short_name: 'SOTRAP', siret: null, address: null, phone: null, email: null, website: null, deleted_at: null },
    casting: [], actions: [], contacts: [], referentContactIds: [],
  }
}

describe('buildCompanyFiche', () => {
  it('nom court préféré ; sans relation → incomplet/à jour', () => {
    const f = buildCompanyFiche(base())
    expect(f.name).toBe('SOTRAP')
    expect(f.status).toBe('incomplete')
    expect(f.attention.level).toBe('ok')
  })

  it('le VOLUME seul ne dégrade pas l\'état : 5 actions ouvertes, aucune en retard, toutes avec référent → à jour', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, mainContactId: null }],
      actions: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, siteId: 's1', siteName: 'Lycée', dueDate: '2027-01-01', hasReferent: true, assignedContactName: null })),
    })
    expect(f.openCount).toBe(5)
    expect(f.overdueCount).toBe(0)
    expect(f.noReferentCount).toBe(0)
    expect(f.attention.level).toBe('ok')
    expect(f.status).toBe('active')
  })

  it('retard → à traiter (urgent), les retards passent en tête', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, mainContactId: null }],
      actions: [
        { id: 'a1', title: 'À jour', siteId: 's1', siteName: 'Lycée', dueDate: '2027-01-01', hasReferent: true, assignedContactName: null },
        { id: 'a2', title: 'En retard', siteId: 's1', siteName: 'Lycée', dueDate: '2026-07-01', hasReferent: false, assignedContactName: null },
      ],
    })
    expect(f.attention.level).toBe('urgent')
    expect(f.overdueCount).toBe(1)
    expect(f.noReferentCount).toBe(1)
    expect(f.actions[0]!.id).toBe('a2') // retard en tête
    expect(f.attention.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['overdue_actions', 'company_no_referent']))
  })

  it('responsable d\'actions mais hors casting actif → à surveiller (left_casting)', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: false, mainContactId: null }], // clôturé
      actions: [{ id: 'a1', title: 'Reste', siteId: 's1', siteName: 'Lycée', dueDate: null, hasReferent: true, assignedContactName: null }],
    })
    expect(f.attention.level).toBe('attention')
    expect(f.attention.reasons.map((r) => r.code)).toContain('company_left_casting')
    expect(f.status).toBe('active') // openCount>0 ⇒ mobilisée
  })

  it('statut PAR chantier séparé (actif vs historique), rôles actifs distincts', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, mainContactId: 'c1' },
        { siteId: 's1', siteName: 'Lycée', role: 'Sous-traitant', active: true, mainContactId: null },
        { siteId: 's2', siteName: 'Collège', role: 'ETV', active: false, mainContactId: null },
      ],
    })
    expect(f.activeCasting).toHaveLength(2)
    expect(f.historicalCasting).toHaveLength(1)
    expect(f.activeSitesCount).toBe(1) // s1 seul actif (2 rôles, 1 chantier)
    expect(f.activeRoles).toEqual(expect.arrayContaining(['ETV', 'Sous-traitant']))
  })

  it('contacts : marque référents d\'actions et contacts principaux de casting', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, mainContactId: 'c1' }],
      contacts: [{ id: 'c1', name: 'Chef', function: 'Conducteur' }, { id: 'c2', name: 'Ref', function: null }],
      referentContactIds: ['c2'],
    })
    const c1 = f.contacts.find((c) => c.id === 'c1')!
    const c2 = f.contacts.find((c) => c.id === 'c2')!
    expect(c1.isMainCasting).toBe(true)
    expect(c1.isReferent).toBe(false)
    expect(c2.isReferent).toBe(true)
    expect(c2.href).toBe('/intervenants/personne/c2')
  })
})
