// Lot 2B Intervenants — composition PURE du read-model consolidé. Vérifie les 3 témoins
// RUS DUMBEA MALL du GO Vincent 2026-09-14 : Clim Exp'Air/Clim'Expair (doublon de nom, à
// réunifier sous le canonique), Pacific Froid Clim (Action au niveau entreprise qui doit
// enfin compter), Maz de Clim Exp'Air (jamais une ligne `companies` → hors de portée par
// construction, aucun risque d'absorption).

import { describe, expect, it } from 'vitest'
import { buildSiteIntervenantsConsolidated, type ConsolidatedInputs } from '@/lib/knowledge/site-intervenants-consolidated'
import type { Company } from '@/lib/db/companies'

const CLIM_EXPAIR = '298927de-87f3-4c31-bdd6-538efd8e31ab' // canonique
const CLIM_EXPAIR_ALIAS = '2488c63a-5d7f-414d-bd70-883edb3c392f' // "Clim'Expair", alias
const PACIFIC_FROID = '6f94cb9d-f82c-40e8-86c3-d4dbc8fcbfeb'

function companiesMap(rows: Array<Pick<Company, 'id' | 'name' | 'status' | 'aliasOfCompanyId'>>) {
  return new Map(rows.map((r) => [r.id, r]))
}

function base(): ConsolidatedInputs {
  return {
    today: '2026-09-14',
    siteId: 'site-rus',
    companiesById: companiesMap([
      { id: CLIM_EXPAIR, name: "Clim Exp'Air", status: 'active', aliasOfCompanyId: null },
      { id: CLIM_EXPAIR_ALIAS, name: "Clim'Expair", status: 'alias', aliasOfCompanyId: CLIM_EXPAIR },
      { id: PACIFIC_FROID, name: 'Pacific Froid Clim', status: 'active', aliasOfCompanyId: null },
    ]),
    casting: [], actions: [], contactById: new Map(), pointsResponsible: [],
    decisions: [], obligations: [],
  }
}

describe('buildSiteIntervenantsConsolidated', () => {
  it("témoin 1 — Clim Exp'Air/Clim'Expair : deux castings sous deux ids distincts fusionnent en une seule entrée canonique", () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      casting: [
        { id: 'si1', companyId: CLIM_EXPAIR, role: 'ETV', effectiveFrom: '2026-01-01', effectiveTo: null },
        { id: 'si2', companyId: CLIM_EXPAIR, role: 'ETV', effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' },
        { id: 'si3', companyId: CLIM_EXPAIR_ALIAS, role: 'ETV', effectiveFrom: '2024-01-01', effectiveTo: '2025-01-01' },
        { id: 'si4', companyId: CLIM_EXPAIR_ALIAS, role: 'ETV', effectiveFrom: '2023-01-01', effectiveTo: '2024-01-01' },
      ],
    })
    expect(r.intervenants).toHaveLength(1)
    const climExpair = r.intervenants[0]!
    expect(climExpair.companyId).toBe(CLIM_EXPAIR)
    expect(climExpair.companyName).toBe("Clim Exp'Air")
    expect(climExpair.mergedCompanyIds).toEqual([CLIM_EXPAIR_ALIAS])
    expect(climExpair.casting).toHaveLength(4) // aucune perte de détail (4 castings distincts conservés)
    expect(climExpair.lastActivityAt).toBe('2026-01-01') // la plus récente des 4 mentions
  })

  it('témoin 2 — Pacific Froid Clim : Action assignée au niveau entreprise (sans contact) compte enfin', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      casting: [{ id: 'si5', companyId: PACIFIC_FROID, role: 'Frigoriste', effectiveFrom: '2026-01-01', effectiveTo: null }],
      actions: [{
        id: 'a1', title: 'Transmettre le contrat Pacific Froid Clim sur Batifire',
        dueDate: null, dueDateStatus: null, status: 'open', createdAt: '2026-06-01',
        assignedCompanyId: PACIFIC_FROID, assignedContactId: null,
      }],
    })
    const pacific = r.intervenants.find((i) => i.companyId === PACIFIC_FROID)
    expect(pacific).toBeDefined()
    expect(pacific!.actions).toHaveLength(1)
    expect(pacific!.actions[0]!.id).toBe('a1')
    expect(pacific!.overdueActionsCount).toBe(0)
  })

  it('témoin 3 — Maz de Clim Exp\'Air (canonical_subject, jamais une ligne companies) : absent de companiesById, ne pollue jamais Clim Exp\'Air', () => {
    // "Maz de Clim Exp'Air" n'a pas d'id `companies` : aucun geste ne peut l'assigner à une
    // Action/casting/Point avec `assigned_company_id`. Ce témoin est donc validé par
    // ABSENCE — rien à agréger, rien à exclure explicitement.
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      casting: [{ id: 'si1', companyId: CLIM_EXPAIR, role: 'ETV', effectiveFrom: '2026-01-01', effectiveTo: null }],
    })
    expect(r.intervenants).toHaveLength(1)
    expect(r.intervenants[0]!.companyId).toBe(CLIM_EXPAIR)
    expect(r.intervenants.some((i) => i.companyName.includes('Maz'))).toBe(false)
  })

  it('Action en retard confirmée (due_date explicite dépassée) incrémente overdueActionsCount', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      actions: [{
        id: 'a1', title: 'En retard', dueDate: '2026-01-01', dueDateStatus: 'explicit', status: 'open',
        createdAt: '2025-12-01', assignedCompanyId: PACIFIC_FROID, assignedContactId: null,
      }],
    })
    const pacific = r.intervenants.find((i) => i.companyId === PACIFIC_FROID)!
    expect(pacific.overdueActionsCount).toBe(1)
    expect(pacific.actions[0]!.overdue).toBe(true)
  })

  it('Action assignée à un contact (pas d\'entreprise directe) roule vers l\'entreprise du contact, résolue au canonique', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      contactById: new Map([['ct1', { id: 'ct1', name: 'Jean Dupont', function: 'Technicien', companyId: CLIM_EXPAIR_ALIAS }]]),
      actions: [{
        id: 'a1', title: 'Contrôler la centrale', dueDate: null, dueDateStatus: null, status: 'open',
        createdAt: '2026-06-01', assignedCompanyId: null, assignedContactId: 'ct1',
      }],
    })
    const climExpair = r.intervenants.find((i) => i.companyId === CLIM_EXPAIR)!
    expect(climExpair.actions).toHaveLength(1)
    expect(climExpair.contacts).toHaveLength(1)
    expect(climExpair.contacts[0]!.name).toBe('Jean Dupont')
    expect(climExpair.contacts[0]!.actionsCount).toBe(1)
  })

  it('Point piloté (tracked_point_responsible_companies) apparaît sous l\'entreprise canonique', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      pointsResponsible: [{ id: 'trc1', companyId: CLIM_EXPAIR_ALIAS, designatedAt: '2026-08-01', pointId: 'pt1', pointLabel: 'Sprinkler HS' }],
    })
    const climExpair = r.intervenants.find((i) => i.companyId === CLIM_EXPAIR)!
    expect(climExpair.pointsPiloted).toHaveLength(1)
    expect(climExpair.pointsPiloted[0]!.label).toBe('Sprinkler HS')
    expect(climExpair.pointsPiloted[0]!.href).toBe('/sites/site-rus/point/pt1')
  })

  it('la dimension "Points où citée" est déclarée comme gap explicite, jamais silencieuse', () => {
    const r = buildSiteIntervenantsConsolidated(base())
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps.join(' ')).toMatch(/Points où citée/)
  })

  it('une Action clôturée/annulée ne compte pas dans "Actions ouvertes" (même ensemble que site-intervenants-view/company-fiche)', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      actions: [{
        id: 'a1', title: 'Déjà traitée', dueDate: null, dueDateStatus: null, status: 'done',
        createdAt: '2026-06-01', assignedCompanyId: PACIFIC_FROID, assignedContactId: null,
      }],
    })
    const pacific = r.intervenants.find((i) => i.companyId === PACIFIC_FROID)
    expect(pacific).toBeUndefined() // aucune autre dimension ne la fait apparaître
  })

  it('un contact sans Action apparaît quand même dans l\'annuaire "Contacts" (actionsCount: 0)', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      casting: [{ id: 'si1', companyId: CLIM_EXPAIR, role: 'ETV', effectiveFrom: '2026-01-01', effectiveTo: null }],
      contactById: new Map([['ct1', { id: 'ct1', name: 'Marie Martin', function: 'Assistante', companyId: CLIM_EXPAIR }]]),
    })
    const climExpair = r.intervenants.find((i) => i.companyId === CLIM_EXPAIR)!
    expect(climExpair.contacts).toHaveLength(1)
    expect(climExpair.contacts[0]!.name).toBe('Marie Martin')
    expect(climExpair.contacts[0]!.actionsCount).toBe(0)
  })

  it('Décision portée directement par l\'entreprise (decisionnaire_company_id, mig 284) apparaît sous le canonique', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      decisions: [{ id: 'd1', titre: 'Remplacer la centrale', statut: 'actee', dateDecision: '2026-08-15', companyId: CLIM_EXPAIR_ALIAS, contactId: null }],
    })
    const climExpair = r.intervenants.find((i) => i.companyId === CLIM_EXPAIR)!
    expect(climExpair.decisions).toHaveLength(1)
    expect(climExpair.decisions[0]!.titre).toBe('Remplacer la centrale')
    expect(climExpair.decisions[0]!.href).toBe('/sites/site-rus/decision/d1')
    expect(climExpair.lastActivityAt).toBe('2026-08-15')
  })

  it('Décision portée via un contact (decisionnaire_contact_id) roule vers l\'entreprise du contact, résolue au canonique', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      contactById: new Map([['ct1', { id: 'ct1', name: 'Jean Dupont', function: 'Technicien', companyId: PACIFIC_FROID }]]),
      decisions: [{ id: 'd1', titre: 'Valider le devis', statut: 'proposee', dateDecision: null, companyId: null, contactId: 'ct1' }],
    })
    const pacific = r.intervenants.find((i) => i.companyId === PACIFIC_FROID)!
    expect(pacific.decisions).toHaveLength(1)
    expect(pacific.decisions[0]!.id).toBe('d1')
  })

  it('une Décision caduque/contredite ne compte pas comme engagement actif', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      decisions: [{ id: 'd1', titre: 'Décision abandonnée', statut: 'caduque', dateDecision: '2026-01-01', companyId: PACIFIC_FROID, contactId: null }],
    })
    const pacific = r.intervenants.find((i) => i.companyId === PACIFIC_FROID)
    expect(pacific).toBeUndefined()
  })

  it('Obligation ouverte (a_produire/en_cours) portée via contact incrémente openObligationsCount, résolue au canonique', () => {
    const r = buildSiteIntervenantsConsolidated({
      ...base(),
      contactById: new Map([['ct1', { id: 'ct1', name: 'Marie Martin', function: 'Assistante', companyId: CLIM_EXPAIR_ALIAS }]]),
      obligations: [
        { contactId: 'ct1', status: 'a_produire' },
        { contactId: 'ct1', status: 'en_cours' },
        { contactId: 'ct1', status: 'satisfaite' },
      ],
    })
    const climExpair = r.intervenants.find((i) => i.companyId === CLIM_EXPAIR)!
    expect(climExpair.openObligationsCount).toBe(2)
  })
})
