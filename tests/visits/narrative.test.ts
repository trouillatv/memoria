import { describe, expect, it } from 'vitest'
import {
  classifyProduced,
  describeLimits,
  explainCapture,
  explainProposal,
  explainProduced,
  type RegistryEntry,
  type ReportLinkedObject,
} from '@/lib/visits/narrative'

// ── N1 — CE QU'ON A LE DROIT D'APPELER « PRODUIT PAR CETTE VISITE » ─────────
//
// « Créé pendant la visite » n'est pas « créé par la visite ». Les deux
// read-models existants confondaient les deux : l'un comptait des INTENTIONS de
// tri, l'autre comptait dans une FENÊTRE TEMPORELLE. Aucun ne prouvait rien.
//
// Ici, deux niveaux de preuve, jamais fondus : le registre nomme l'objet ; le
// report_id le rattache. Rien d'autre n'entre.

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  item_key: 'action:0',
  entity_type: 'action',
  entity_id: 'act-1',
  created_at: '2026-07-21T06:00:00Z',
  source_text: 'Relancer Yann',
  sourceSection: 'actions',
  ...over,
})

const linked = (over: Partial<ReportLinkedObject> = {}): ReportLinkedObject => ({
  kind: 'action',
  id: 'act-9',
  label: 'Action historique',
  createdAt: '2026-06-01T08:00:00Z',
  ...over,
})

describe('Le registre prouve, et il l’emporte', () => {
  it('nomme l’objet, sa section et sa clé', () => {
    const [p] = classifyProduced([entry()], [])
    expect(p).toMatchObject({
      kind: 'action',
      id: 'act-1',
      label: 'Relancer Yann',
      provenance: 'registry',
      sourceSection: 'actions',
      itemKey: 'action:0',
    })
  })

  it('un objet prouvé ET rattaché n’apparaît qu’une fois, au niveau le plus fort', () => {
    const out = classifyProduced([entry()], [linked({ id: 'act-1' })])
    expect(out).toHaveLength(1)
    expect(out[0]!.provenance).toBe('registry')
  })
})

describe('Le rattachement complète, sans se faire passer pour une preuve', () => {
  it('marque « report » et n’invente ni section ni clé', () => {
    const [p] = classifyProduced([], [linked()])
    expect(p!.provenance).toBe('report')
    expect(p!.sourceSection).toBeUndefined()
    expect(p!.itemKey).toBeUndefined()
  })

  it('les deux niveaux cohabitent sans se mélanger', () => {
    const out = classifyProduced([entry()], [linked()])
    expect(out.map((p) => p.provenance)).toEqual(['registry', 'report'])
  })
})

describe('Rien d’autre n’entre dans « produit »', () => {
  it('sans registre ni rattachement, la visite n’a rien produit', () => {
    expect(classifyProduced([], [])).toEqual([])
  })

  it('aucune date ne fait entrer un objet — pas d’heuristique temporelle', () => {
    // Un objet créé le même jour, mais sans lien : il n'est PAS produit par la
    // visite. C'est tout l'écart entre « pendant » et « par ».
    const out = classifyProduced([], [])
    expect(out).toHaveLength(0)
  })

  it('ne dédoublonne pas deux objets distincts de même famille', () => {
    const out = classifyProduced(
      [entry(), entry({ item_key: 'action:1', entity_id: 'act-2', source_text: 'Commander' })],
      [],
    )
    expect(out).toHaveLength(2)
  })

  it('ne confond pas deux familles portant le même identifiant', () => {
    const out = classifyProduced([], [linked({ kind: 'action', id: 'x' }), linked({ kind: 'reserve', id: 'x' })])
    expect(out).toHaveLength(2)
  })
})

describe('Les limites se disent', () => {
  it('compte les attributions historiques, celles qu’on ne peut pas prouver finement', () => {
    const limites = describeLimits(classifyProduced([entry()], [linked(), linked({ id: 'act-8' })]))
    expect(limites.historicalAttributions).toBe(2)
  })

  it('déclare que l’intervenant n’a pas encore de provenance (N2)', () => {
    expect(describeLimits([]).intervenantProvenanceMissing).toBe(true)
  })
})

describe('Chaque élément dit pourquoi il est là', () => {
  it('une capture écartée le dit, sans juger', () => {
    expect(explainCapture({ kept: false, intent: null })).toMatchObject({
      code: 'capture.discarded',
      label: 'Écartée du compte-rendu par le conducteur',
    })
  })

  it.each([
    ['action', 'action à prévoir'],
    ['reserve', 'réserve à lever'],
    ['follow', 'point à surveiller'],
  ])('une capture taguée « %s » cite le tag du conducteur', (intent, mot) => {
    expect(explainCapture({ kept: true, intent }).label).toContain(mot)
  })

  it('une obsolescence n’est JAMAIS présentée comme un rejet humain', () => {
    const r = explainProposal({ status: 'superseded' })
    expect(r.label).toBe('Devenue obsolète après une nouvelle analyse')
    expect(r.label).not.toMatch(/ignor|écart|refus/i)
  })

  it.each([
    ['confirmed', 'Confirmée par un humain'],
    ['dismissed', 'Écartée par un humain'],
    ['proposed', 'Proposée par MemorIA, en attente d’arbitrage'],
  ])('une proposition « %s » dit son sort', (status, attendu) => {
    expect(explainProposal({ status }).label).toBe(attendu)
  })

  it('un objet né du compte-rendu cite SA section', () => {
    expect(
      explainProduced({
        kind: 'action', id: 'a', label: 'x', createdAt: null,
        provenance: 'registry', sourceSection: 'actions',
      }).label,
    ).toBe('Créé à partir de la section « Actions » du compte-rendu')
  })

  it('un objet né d’une proposition le dit autrement', () => {
    expect(
      explainProduced({
        kind: 'intervenant', id: 'i', label: 'Clim Expert', createdAt: null,
        provenance: 'registry', sourceSection: 'propositions',
      }).code,
    ).toBe('produced.fromProposal')
  })

  it('un simple rattachement AVOUE qu’il ne prouve rien', () => {
    const r = explainProduced({ kind: 'action', id: 'a', label: 'x', createdAt: null, provenance: 'report' })
    expect(r.code).toBe('produced.linked')
    expect(r.label).toContain('n’est pas démontrable')
  })
})
