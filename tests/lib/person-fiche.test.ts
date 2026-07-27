// Lot 2B.3A — composition PURE de la fiche Personne. Vérifie statut, attention
// (alignée sur le cockpit : SON overdue = actions référent), liens, et non-fusion.

import { describe, expect, it } from 'vitest'
import { buildPersonFiche, type PersonFicheInputs } from '@/lib/db/person-fiche'

function base(): PersonFicheInputs {
  return {
    today: '2026-07-27',
    contact: { id: 'c1', full_name: 'Jean Dupont', function: 'Électricien', company_id: null, is_internal_agent: true, email: null, phone: null, mobile: null },
    companyName: null,
    teams: [], casting: [], referentActions: [], companyActions: [], decisions: [],
    linkedAccountUserId: null,
  }
}

describe('buildPersonFiche', () => {
  it('agent interne sans équipe → incomplet + à surveiller', () => {
    const f = buildPersonFiche(base())
    expect(f.category).toBe('Agent interne')
    expect(f.status).toBe('incomplete')
    expect(f.attention.level).toBe('attention')
    expect(f.attention.reasons.map((r) => r.code)).toContain('agent_no_team')
  })

  it('agent avec équipe active + action en retard → actif + à traiter, liens corrects', () => {
    const f = buildPersonFiche({
      ...base(),
      teams: [{ id: 't1', name: 'Électricité', active: true }],
      referentActions: [{ id: 'a1', title: 'Poser tableau', siteId: 's1', siteName: 'Lycée', dueDate: '2026-07-01' }],
    })
    expect(f.status).toBe('active')
    expect(f.attention.level).toBe('urgent')
    expect(f.overdueCount).toBe(1)
    expect(f.actionsAsReferent[0]!.href).toBe('/sites/s1/action/a1')
    expect(f.actionsAsReferent[0]!.overdue).toBe(true)
    expect(f.teams[0]!.href).toBe('/equipes/t1')
  })

  it('actions via l\'entreprise ne pilotent PAS l\'état de la personne', () => {
    const f = buildPersonFiche({
      ...base(),
      contact: { ...base().contact, is_internal_agent: false, company_id: 'co1' },
      companyName: 'ETV',
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: true }],
      companyActions: [{ id: 'a9', title: 'Reprise', siteId: 's1', siteName: 'Lycée', dueDate: '2026-07-01' }],
    })
    // La personne est active (casting) et n'a PAS d'action référent en retard → à jour,
    // même si son entreprise porte une action en retard (contexte, pas son état).
    expect(f.attention.level).toBe('ok')
    expect(f.actionsViaCompany).toHaveLength(1)
    expect(f.overdueCount).toBe(0)
  })

  it('contact externe historique (aucune relation active) → statut historique', () => {
    const f = buildPersonFiche({
      ...base(),
      contact: { ...base().contact, is_internal_agent: false, company_id: 'co1' },
      companyName: 'ETV',
      casting: [{ siteId: 's1', siteName: 'Lycée', role: 'ETV', active: false }],
    })
    expect(f.status).toBe('historical')
    expect(f.attention.level).toBe('ok')
  })

  it('compte lié → signalé, jamais fusionné (identité reste le contact)', () => {
    const f = buildPersonFiche({ ...base(), linkedAccountUserId: 'u1' })
    expect(f.id).toBe('c1')
    expect(f.linkedAccountUserId).toBe('u1')
  })
})
