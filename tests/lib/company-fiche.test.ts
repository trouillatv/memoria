// Lot 2B.3B — composition PURE de la fiche Entreprise. Vérifie que le VOLUME seul ne
// dégrade jamais l'état, le statut par chantier, et l'attention via politique commune.

import { describe, expect, it } from 'vitest'
import { buildCompanyFiche, type CompanyFicheInputs } from '@/lib/db/company-fiche'

function base(): CompanyFicheInputs {
  return {
    today: '2026-07-27',
    company: { id: 'co1', name: 'SOTRAP SARL', short_name: 'SOTRAP', siret: null, address: null, phone: null, email: null, website: null, deleted_at: null },
    casting: [], actions: [], contacts: [], referentContactIds: [], subjectsCarried: [],
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
      casting: [{ id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: null }],
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
      casting: [{ id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: null }],
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
      casting: [{ id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: false, effectiveFrom: '2025-06-01', mainContactId: null, source: null, sourceReportId: null }], // clôturé
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
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-02-01', mainContactId: 'c1', source: null, sourceReportId: null },
        { id: 'si2', siteId: 's1', siteName: 'Lycée', role: 'Sous-traitant', active: true, effectiveFrom: '2026-03-01', mainContactId: null, source: null, sourceReportId: null },
        { id: 'si3', siteId: 's2', siteName: 'Collège', role: 'ETV', active: false, effectiveFrom: '2025-06-01', mainContactId: null, source: null, sourceReportId: null },
      ],
    })
    expect(f.activeCasting).toHaveLength(2)
    expect(f.historicalCasting).toHaveLength(1)
    expect(f.activeSitesCount).toBe(1) // s1 seul actif (2 rôles, 1 chantier)
    expect(f.roleMentions.map((r) => r.role)).toEqual(expect.arrayContaining(['ETV', 'Sous-traitant']))
  })

  it('roleMentions inclut les mentions closes (chronologie documentaire complète), marquées comme telles', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'AMO', active: true, effectiveFrom: '2026-02-01', mainContactId: null, source: null, sourceReportId: null },
        { id: 'si2', siteId: 's2', siteName: 'Collège', role: 'Entreprise titulaire', active: false, effectiveFrom: '2024-06-12', mainContactId: null, source: { linkLabel: 'Voir la visite', href: '/sites/s2/visites/r1' }, sourceReportId: 'r1' },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    const active = f.roleMentions.find((r) => r.role === 'AMO')!
    const closed = f.roleMentions.find((r) => r.role === 'Entreprise titulaire')!
    expect(active.active).toBe(true)
    expect(active.source).toBeNull()
    expect(closed.active).toBe(false)
    expect(closed.source).toEqual({ linkLabel: 'Voir la visite', href: '/sites/s2/visites/r1' })
  })

  // Audit P0.2 (2026-09-09) : l'identité d'une mention = rôle + date + chantier
  // + preuve (source_report_id). Deux PV distincts ne sont JAMAIS fusionnés,
  // même en partageant rôle, date et chantier — sinon on perd une preuve.
  // Correctif P0.2 (même jour) : sans preuve connue, la clé replie sur
  // `site_intervenants.id` (une ligne = une mention) — jamais sur un sentinel
  // partagé (`∅`) qui fusionnerait à nouveau des mentions non prouvées.

  it('P0.2 #1 — même rôle + même date + 2 chantiers + 2 PV → 2 mentions distinctes', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'OCEF2', role: "maître d'œuvre", active: true, effectiveFrom: '2026-07-30', mainContactId: null, source: { linkLabel: 'Voir la visite', href: '/sites/s1/visites/r1' }, sourceReportId: 'r1' },
        { id: 'si2', siteId: 's2', siteName: 'OCEF5', role: "maître d'œuvre", active: true, effectiveFrom: '2026-07-30', mainContactId: null, source: { linkLabel: 'Voir la visite', href: '/sites/s2/visites/r2' }, sourceReportId: 'r2' },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    expect(f.roleMentions.map((r) => r.siteId).sort()).toEqual(['s1', 's2'])
    expect(f.roleMentions.find((r) => r.siteId === 's1')!.source?.href).toBe('/sites/s1/visites/r1')
    expect(f.roleMentions.find((r) => r.siteId === 's2')!.source?.href).toBe('/sites/s2/visites/r2')
  })

  it('P0.2 #2 — même rôle + même date + même chantier + 2 PV → 2 mentions distinctes (pas de preuve perdue)', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: { linkLabel: 'Voir le PV', href: '/sites/s1/pv/r1' }, sourceReportId: 'r1' },
        { id: 'si2', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: { linkLabel: 'Voir le PV', href: '/sites/s1/pv/r2' }, sourceReportId: 'r2' },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    expect(f.roleMentions.map((r) => r.source?.href).sort()).toEqual(['/sites/s1/pv/r1', '/sites/s1/pv/r2'])
  })

  it('P0.2 #3 — doublon exact (même source_report_id) → dédup autorisée, reste actif si au moins une occurrence l\'est', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: false, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: 'r1' },
        { id: 'si2', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: { linkLabel: 'Voir le PV', href: '/sites/s1/pv/r1' }, sourceReportId: 'r1' },
      ],
    })
    expect(f.roleMentions).toHaveLength(1)
    expect(f.roleMentions[0]!.active).toBe(true)
    expect(f.roleMentions[0]!.source?.href).toBe('/sites/s1/pv/r1')
  })

  it('P0.2 #4 — source NULL : aucune provenance inventée, jamais de lien fabriqué', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: null },
      ],
    })
    expect(f.roleMentions).toHaveLength(1)
    expect(f.roleMentions[0]!.source).toBeNull()
  })

  it('P0.2 #5 — active et historique restent distinguées correctement malgré la nouvelle clé', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-02-01', mainContactId: null, source: null, sourceReportId: 'r1' },
        { id: 'si2', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: false, effectiveFrom: '2025-06-01', mainContactId: null, source: null, sourceReportId: 'r2' },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    expect(f.roleMentions.find((r) => r.effectiveFrom === '2026-02-01')!.active).toBe(true)
    expect(f.roleMentions.find((r) => r.effectiveFrom === '2025-06-01')!.active).toBe(false)
  })

  it('P0.2 #6 — même rôle + même date + même chantier + sourceReportId NULL + 2 site_intervenants.id distincts → 2 mentions (undermerge, jamais de fusion sans preuve)', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [
        { id: 'si-a', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: null },
        { id: 'si-b', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-01-01', mainContactId: null, source: null, sourceReportId: null },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    expect(f.roleMentions.every((r) => r.source === null)).toBe(true)
  })

  it('P0.2 — rejoue une collision réelle (Démo MemorIA, maître d\'œuvre, 2026-07-30, OCEF2/OCEF5) : 1 → 2 mentions avec le bon lien chacune', () => {
    const f = buildCompanyFiche({
      ...base(),
      company: { id: 'bbf22bf2', name: 'Entreprise', short_name: null, siret: null, address: null, phone: null, email: null, website: null, deleted_at: null },
      casting: [
        { id: 'si1', siteId: 'a63efe41', siteName: 'OCEF2', role: "maître d'œuvre", active: true, effectiveFrom: '2026-07-30', mainContactId: null, source: { linkLabel: 'Voir la visite', href: '/sites/a63efe41/visites/5c61af46' }, sourceReportId: '5c61af46-0315-4ad4-bd41-8f6329f773fe' },
        { id: 'si2', siteId: '61e4de06', siteName: 'OCEF5', role: "maître d'œuvre", active: true, effectiveFrom: '2026-07-30', mainContactId: null, source: { linkLabel: 'Voir la visite', href: '/sites/61e4de06/visites/a40d8c77' }, sourceReportId: 'a40d8c77-35f6-459c-b479-ef744f1da5ab' },
      ],
    })
    expect(f.roleMentions).toHaveLength(2)
    expect(f.roleMentions.find((r) => r.siteId === 'a63efe41')!.source?.href).toBe('/sites/a63efe41/visites/5c61af46')
    expect(f.roleMentions.find((r) => r.siteId === '61e4de06')!.source?.href).toBe('/sites/61e4de06/visites/a40d8c77')
  })

  it('contacts : marque référents d\'actions et contacts principaux de casting', () => {
    const f = buildCompanyFiche({
      ...base(),
      casting: [{ id: 'si1', siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true, effectiveFrom: '2026-02-01', mainContactId: 'c1', source: null, sourceReportId: null }],
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
