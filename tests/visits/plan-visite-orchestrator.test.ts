// ORCHESTRATEUR PLAN DE VISITE (Lot B) — point d'écriture unique d'un verdict
// terrain. Unit test entièrement mocké (pattern tests/lib/team-field-members.test.ts) :
// auth + primitives métier + Supabase admin sont simulés, ce qui permet de
// prouver le CONTRAT d'écriture (routage, ordre, refus, idempotence,
// permission, commentaire obligatoire, non-substituabilité de la source) sans
// dépendre de la migration 432 ni d'un fixture multi-tables réel.
//
// Hors périmètre ICI (déjà couvert ailleurs, cf. tests/visits/watchlist-seed-projection.test.ts) :
// la réapparition N+1 côté SEED — elle est structurellement garantie en amont
// par lib/db/site-memory-signals.ts, qui ne resélectionne que les sources
// encore dans un état non terminal (status='open' / statut='actee' / etc.).
// Une fois la source mutée vers son état terminal par CE module, elle sort
// mécaniquement du signal correspondant — donc du prochain seed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── État configurable de la « base » et de l'auth simulées ──────────────────

let fieldAgent: { userId: string; role: string } | { error: string } =
  { userId: 'user-1', role: 'chef_equipe' }
let orgRole: { ok: true; context: { userId: string; organizationId: string; role: string } } | { ok: false; error: string } =
  { ok: true, context: { userId: 'user-1', organizationId: 'org-1', role: 'chef_equipe' } }

let watchlistItemRow: { id: string; source_kind: string | null; source_ref: string | null } | null =
  { id: 'item-1', source_kind: 'reserve_open', source_ref: 'res-1' }
let siteRow: { organization_id: string } | null = { organization_id: 'org-1' }
let reserveRow: { id: string; status: string } | null = { id: 'res-1', status: 'open' }
let actionRow: { id: string; status: string } | null = { id: 'act-1', status: 'open' }
let obligationRow: { id: string; status: string } | null = { id: 'obl-1', status: 'a_produire' }
let decisionRow: { statut: string } | null = { statut: 'actee' }

vi.mock('@/lib/field/auth', () => ({
  requireFieldAgent: async () => fieldAgent,
}))

vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationRole: async () => orgRole,
}))

function makeChain(row: unknown) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'in', 'is', 'ilike', 'order', 'limit', 'neq', 'not']) chain[m] = self
  chain.maybeSingle = async () => ({ data: row, error: null })
  chain.single = async () => ({ data: row, error: null })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'visit_watchlist_item': return makeChain(watchlistItemRow)
        case 'sites': return makeChain(siteRow)
        case 'site_reserve': return makeChain(reserveRow)
        case 'site_actions': return makeChain(actionRow)
        case 'site_obligation': return makeChain(obligationRow)
        default: return makeChain(null)
      }
    },
  }),
}))

const liftReserveMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/site-reserve', () => ({
  liftReserve: (input: unknown) => liftReserveMock(input),
}))

const markSiteActionDoneMock = vi.fn(async (..._a: unknown[]) => {})
const confirmSiteActionOpenMock = vi.fn(async (..._a: unknown[]) => {})
const discardSiteActionMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/site-actions', () => ({
  markSiteActionDone: (...a: unknown[]) => markSiteActionDoneMock(...a),
  confirmSiteActionOpen: (...a: unknown[]) => confirmSiteActionOpenMock(...a),
  discardSiteAction: (...a: unknown[]) => discardSiteActionMock(...a),
}))

const getSiteDecisionMock = vi.fn(async (_siteId: string, _id: string) => decisionRow)
const updateSiteDecisionMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/site-decisions', () => ({
  getSiteDecision: (siteId: string, id: string) => getSiteDecisionMock(siteId, id),
  updateSiteDecision: (...a: unknown[]) => updateSiteDecisionMock(...a),
}))

const setObligationStatusMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/obligations', () => ({
  setObligationStatus: (...a: unknown[]) => setObligationStatusMock(...a),
}))

const setWatchlistItemStateMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/visit-watchlist', () => ({
  setWatchlistItemState: (...a: unknown[]) => setWatchlistItemStateMock(...a),
}))

import { submitPlanVisiteVerdict } from '@/lib/visits/plan-visite-orchestrator'

const BASE_INPUT = { watchlistItemId: 'item-1', reportId: 'report-1', siteId: 'site-1' }

beforeEach(() => {
  fieldAgent = { userId: 'user-1', role: 'chef_equipe' }
  orgRole = { ok: true, context: { userId: 'user-1', organizationId: 'org-1', role: 'chef_equipe' } }
  watchlistItemRow = { id: 'item-1', source_kind: 'reserve_open', source_ref: 'res-1' }
  siteRow = { organization_id: 'org-1' }
  reserveRow = { id: 'res-1', status: 'open' }
  actionRow = { id: 'act-1', status: 'open' }
  obligationRow = { id: 'obl-1', status: 'a_produire' }
  decisionRow = { statut: 'actee' }
  liftReserveMock.mockClear()
  markSiteActionDoneMock.mockClear()
  confirmSiteActionOpenMock.mockClear()
  discardSiteActionMock.mockClear()
  getSiteDecisionMock.mockClear()
  updateSiteDecisionMock.mockClear()
  setObligationStatusMock.mockClear()
  setWatchlistItemStateMock.mockClear()
})

// ── reserve_open ──────────────────────────────────────────────────────────

describe('reserve_open', () => {
  it('positif → liftReserve puis verdict checked', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif', comment: 'levée constatée' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'res-1', liftNote: 'levée constatée', userId: 'user-1' }),
    )
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', 'levée constatée', 'user-1')
  })

  it('negatif → constat pur, aucune mutation, verdict still_open', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'still_open', null, 'user-1')
  })

  it('sans_objet_visite → constat pur, verdict not_applicable_visit (peut réapparaître)', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'sans_objet_visite' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'not_applicable_visit', null, 'user-1')
  })

  it('ne_plus_suivre — jamais proposé pour une réserve (aucune telle option) → invalid_verdict', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre' })
    expect(r).toEqual({ ok: false, code: 'invalid_verdict', error: expect.any(String) })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })

  it('idempotent — réserve déjà levée : primitive non rejouée mais verdict persisté', async () => {
    reserveRow = { id: 'res-1', status: 'lifted' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', null, 'user-1')
  })

  it('réserve introuvable pour ce site → not_found, aucune écriture watchlist', async () => {
    reserveRow = null
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'not_found', error: expect.any(String) })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })
})

// ── action_overdue ────────────────────────────────────────────────────────

describe('action_overdue', () => {
  beforeEach(() => {
    watchlistItemRow = { id: 'item-1', source_kind: 'action_overdue', source_ref: 'act-1' }
  })

  it('positif exige un commentaire réel → refus comment_required si absent', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'comment_required', error: expect.any(String) })
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
  })

  it('positif avec commentaire réel → markSiteActionDone puis checked', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif', comment: 'fait ce jour' })
    expect(r).toEqual({ ok: true })
    expect(markSiteActionDoneMock).toHaveBeenCalledWith('act-1', { comment: 'fait ce jour' }, 'user-1')
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', 'fait ce jour', 'user-1')
  })

  it('positif refuse un commentaire blanc (espaces seuls)', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif', comment: '   ' })
    expect(r).toEqual({ ok: false, code: 'comment_required', error: expect.any(String) })
  })

  it('positif sur action déjà cancelled → incompatible_state (fn_complete_action ne filtre pas ce cas)', async () => {
    actionRow = { id: 'act-1', status: 'cancelled' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif', comment: 'fait' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
  })

  it('positif idempotent — action déjà done : primitive non rejouée, verdict persisté', async () => {
    actionRow = { id: 'act-1', status: 'done' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif', comment: 'fait' })
    expect(r).toEqual({ ok: true })
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
  })

  it('negatif → confirmSiteActionOpen (constat actif), verdict still_open, sans commentaire requis', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: true })
    expect(confirmSiteActionOpenMock).toHaveBeenCalledWith('act-1', null, 'user-1', {
      source: 'visit_watchlist', reportId: 'report-1', watchlistItemId: 'item-1',
    })
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'still_open', null, 'user-1')
  })

  it('negatif — fn_confirm_action_open lève (objet non actif) → incompatible_state, verdict non persisté', async () => {
    confirmSiteActionOpenMock.mockRejectedValueOnce(new Error('fn_confirm_action_open: objet non actif (done)'))
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.stringContaining('non actif') })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })

  it('sans_objet_visite → constat pur, aucune mutation, verdict not_applicable_visit', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'sans_objet_visite' })
    expect(r).toEqual({ ok: true })
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
    expect(confirmSiteActionOpenMock).not.toHaveBeenCalled()
    expect(discardSiteActionMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'not_applicable_visit', null, 'user-1')
  })

  it('ne_plus_suivre exige un commentaire réel → refus comment_required si absent', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre' })
    expect(r).toEqual({ ok: false, code: 'comment_required', error: expect.any(String) })
    expect(discardSiteActionMock).not.toHaveBeenCalled()
  })

  it('ne_plus_suivre avec commentaire → discardSiteAction(non_applicable) puis dismissed_permanently', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre', comment: 'obsolète' })
    expect(r).toEqual({ ok: true })
    expect(discardSiteActionMock).toHaveBeenCalledWith('act-1', 'non_applicable', 'obsolète', 'user-1')
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'dismissed_permanently', 'obsolète', 'user-1')
  })

  it('ne_plus_suivre sur action déjà faite → incompatible_state (jamais de faux positif silencieux)', async () => {
    actionRow = { id: 'act-1', status: 'done' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre', comment: 'obsolète' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(discardSiteActionMock).not.toHaveBeenCalled()
  })

  it('ne_plus_suivre idempotent — action déjà cancelled : primitive non rejouée, verdict persisté', async () => {
    actionRow = { id: 'act-1', status: 'cancelled' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre', comment: 'obsolète' })
    expect(r).toEqual({ ok: true })
    expect(discardSiteActionMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'dismissed_permanently', 'obsolète', 'user-1')
  })
})

// ── decision_unapplied ────────────────────────────────────────────────────

describe('decision_unapplied', () => {
  beforeEach(() => {
    watchlistItemRow = { id: 'item-1', source_kind: 'decision_unapplied', source_ref: 'dec-1' }
  })

  it('positif → updateSiteDecision(appliquee) puis checked', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: true })
    expect(updateSiteDecisionMock).toHaveBeenCalledWith('site-1', 'dec-1', { statut: 'appliquee' })
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', null, 'user-1')
  })

  it('negatif → constat pur, verdict still_open', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: true })
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
  })

  it('ne_plus_suivre → updateSiteDecision(caduque) puis dismissed_permanently', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre', comment: 'sans suite' })
    expect(r).toEqual({ ok: true })
    expect(updateSiteDecisionMock).toHaveBeenCalledWith('site-1', 'dec-1', { statut: 'caduque' })
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'dismissed_permanently', 'sans suite', 'user-1')
  })

  it('positif refusé si décision déjà caduque (opposé)', async () => {
    decisionRow = { statut: 'caduque' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
  })

  it('ne_plus_suivre refusé si décision déjà appliquee (opposé)', async () => {
    decisionRow = { statut: 'appliquee' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
  })

  it('positif idempotent — décision déjà appliquee : primitive non rejouée, verdict persisté', async () => {
    decisionRow = { statut: 'appliquee' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: true })
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', null, 'user-1')
  })

  it('décision introuvable → not_found', async () => {
    decisionRow = null
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'not_found', error: expect.any(String) })
  })
})

// ── obligation_neglected ──────────────────────────────────────────────────

describe('obligation_neglected', () => {
  beforeEach(() => {
    watchlistItemRow = { id: 'item-1', source_kind: 'obligation_neglected', source_ref: 'obl-1' }
  })

  it('positif → setObligationStatus(satisfaite) puis checked', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: true })
    expect(setObligationStatusMock).toHaveBeenCalledWith('obl-1', 'satisfaite', null)
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', null, 'user-1')
  })

  it('ne_plus_suivre → setObligationStatus(non_applicable) puis dismissed_permanently', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre', comment: 'non pertinent' })
    expect(r).toEqual({ ok: true })
    expect(setObligationStatusMock).toHaveBeenCalledWith('obl-1', 'non_applicable', 'non pertinent')
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'dismissed_permanently', 'non pertinent', 'user-1')
  })

  it('positif refusé si obligation déjà non_applicable (opposé)', async () => {
    obligationRow = { id: 'obl-1', status: 'non_applicable' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(setObligationStatusMock).not.toHaveBeenCalled()
  })

  it('ne_plus_suivre refusé si obligation déjà satisfaite (opposé)', async () => {
    obligationRow = { id: 'obl-1', status: 'satisfaite' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre' })
    expect(r).toEqual({ ok: false, code: 'incompatible_state', error: expect.any(String) })
    expect(setObligationStatusMock).not.toHaveBeenCalled()
  })

  it('obligation introuvable → not_found', async () => {
    obligationRow = null
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: false, code: 'not_found', error: expect.any(String) })
  })
})

// ── proof_window_closing — jamais de mutation, jamais de sans_objet/ne_plus_suivre ──

describe('proof_window_closing', () => {
  beforeEach(() => {
    watchlistItemRow = { id: 'item-1', source_kind: 'proof_window_closing', source_ref: 'pw-1' }
  })

  it('positif → constat pur, verdict checked, aucune primitive appelée', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).not.toHaveBeenCalled()
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
    expect(setObligationStatusMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'checked', null, 'user-1')
  })

  it('negatif → constat pur, verdict still_open, aucune primitive appelée', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).not.toHaveBeenCalled()
    expect(markSiteActionDoneMock).not.toHaveBeenCalled()
    expect(updateSiteDecisionMock).not.toHaveBeenCalled()
    expect(setObligationStatusMock).not.toHaveBeenCalled()
    expect(setWatchlistItemStateMock).toHaveBeenCalledWith('item-1', 'still_open', null, 'user-1')
  })

  it('sans_objet_visite jamais proposé pour une fenêtre de preuve → invalid_verdict', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'sans_objet_visite' })
    expect(r).toEqual({ ok: false, code: 'invalid_verdict', error: expect.any(String) })
  })

  it('ne_plus_suivre jamais proposé pour une fenêtre de preuve → invalid_verdict', async () => {
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'ne_plus_suivre' })
    expect(r).toEqual({ ok: false, code: 'invalid_verdict', error: expect.any(String) })
  })
})

// ── Permissions et non-substituabilité de la source ──────────────────────

describe('autorisation contextuelle', () => {
  it('refuse si requireFieldAgent échoue (rôle hors chef_equipe/admin/manager)', async () => {
    fieldAgent = { error: 'Rôle non autorisé' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: false, code: 'forbidden', error: 'Rôle non autorisé' })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })

  it('refuse si requireOrganizationRole échoue (pas membre actif de CETTE organisation)', async () => {
    orgRole = { ok: false, error: 'Accès refusé' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: false, code: 'forbidden', error: 'Accès refusé' })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })

  it('item introuvable pour ce (id, report, site) → not_found AVANT toute mutation ou vérif d\'org', async () => {
    watchlistItemRow = null
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: false, code: 'not_found', error: expect.any(String) })
    expect(setWatchlistItemStateMock).not.toHaveBeenCalled()
  })

  it('site introuvable → not_found', async () => {
    siteRow = null
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'negatif' })
    expect(r).toEqual({ ok: false, code: 'not_found', error: expect.any(String) })
  })

  it('substitution impossible — source_kind/source_ref viennent EXCLUSIVEMENT de la ligne relue, jamais de l\'appelant', async () => {
    // L'input ne porte aucun champ source_kind/source_ref/organizationId : seul
    // watchlistItemId/reportId/siteId sont acceptés (cf. SubmitPlanVisiteVerdictInput).
    // La ligne relue fait autorité — reserve_open route vers lift_reserve quel
    // que soit ce que l'appelant "croit" être la source.
    watchlistItemRow = { id: 'item-1', source_kind: 'reserve_open', source_ref: 'res-1' }
    const r = await submitPlanVisiteVerdict({ ...BASE_INPUT, verdict: 'positif' } as never)
    expect(r).toEqual({ ok: true })
    expect(liftReserveMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-1' }))
  })
})
