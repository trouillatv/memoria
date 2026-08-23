// SENTINELLES DE LA PROJECTION DÉTERMINISTE DU SUJET CANONIQUE
//
// Ces sept cas sont ceux exigés au GO du 2026-08-24. Ils ne sont pas décoratifs :
// chacun reproduit une situation RÉELLE mesurée en production par l'audit
// PRODUCT-CANONICAL-OBJECT-BRIDGE sur le chantier PETRO.
//
// Quatre d'entre eux vérifient qu'un lien EST posé. Trois vérifient qu'il ne
// l'est PAS — et ceux-là comptent autant. Un système qui sait dire « je ne sais
// pas » est le comportement voulu ; une couverture de 100 % serait le symptôme
// d'un rattachement fabriqué.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

// ── Faux client admin ────────────────────────────────────────────────────────
// Reproduit exactement les formes de requête utilisées par le helper :
//   select().eq().in().is().not(f,'is',null) | update().eq().is() | maybeSingle()
function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' = 'select'
    let payload: Row = {}

    const run = () => {
      const rows = tables[table] ?? []
      const matched = rows.filter((r) => filters.every((f) => f(r)))
      if (mode === 'update') matched.forEach((r) => Object.assign(r, payload))
      return matched.map((r) => ({ ...r }))
    }

    const api = {
      select: () => ((mode = 'select'), api),
      update: (p: Row) => ((mode = 'update'), (payload = p), api),
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      in: (f: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[f])), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      not: (f: string, _op: string, v: null) => (filters.push((r) => (r[f] ?? null) !== v), api),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (x: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

import { projectCanonicalSubjectOnObjects } from '@/lib/db/canonical-subject-project'

const SITE = 'site-petro'
const REPORT = 'report-petro'

/**
 * Jeu de données calqué sur les sentinelles PETRO de l'audit.
 * Reconstruit à chaque test : les projections écrivent réellement dedans.
 */
function seed(): Tables {
  return {
    canonical_subject: [
      { id: 'cs-cadenas', site_id: SITE, status: 'active', merged_into: null },
      { id: 'cs-eau', site_id: SITE, status: 'active', merged_into: null },
      { id: 'cs-nettoyage-panneaux', site_id: SITE, status: 'active', merged_into: null },
      { id: 'cs-nettoyage-sols', site_id: SITE, status: 'active', merged_into: null },
      { id: 'cs-autre', site_id: SITE, status: 'active', merged_into: null },
      // Chaîne à deux sauts : l'audit en a compté 31 en production.
      { id: 'cs-perdant-1', site_id: SITE, status: 'merged', merged_into: 'cs-perdant-2' },
      { id: 'cs-perdant-2', site_id: SITE, status: 'merged', merged_into: 'cs-vainqueur' },
      { id: 'cs-vainqueur', site_id: SITE, status: 'active', merged_into: null },
    ],

    subject_thread_identity: [
      { subject_thread_id: 'th-eau', site_id: SITE, canonical_subject_id: 'cs-eau' },
      { subject_thread_id: 'th-fusionne', site_id: SITE, canonical_subject_id: 'cs-perdant-1' },
      { subject_thread_id: 'th-conflit', site_id: SITE, canonical_subject_id: 'cs-cadenas' },
    ],

    site_actions: [
      // 1. Cadenas — promue depuis le terrain, canonique porté par la proposition.
      { id: 'a-cadenas', site_id: SITE, report_id: REPORT, canonical_subject_id: null, subject_thread_id: null },
      // 2. Eau panneaux — thread ET matérialisation, concordants (cas des 63/63).
      { id: 'a-eau', site_id: SITE, report_id: REPORT, canonical_subject_id: null, subject_thread_id: 'th-eau' },
      // 3. Planning — aucune preuve structurelle.
      { id: 'a-planning', site_id: SITE, report_id: REPORT, canonical_subject_id: null, subject_thread_id: null },
      // 5. Cible fusionnée sur deux niveaux.
      { id: 'a-fusion', site_id: SITE, report_id: REPORT, canonical_subject_id: null, subject_thread_id: 'th-fusionne' },
      // 6. Deux preuves contradictoires.
      { id: 'a-conflit', site_id: SITE, report_id: REPORT, canonical_subject_id: null, subject_thread_id: 'th-conflit' },
      // 7. FK déjà posée, et une preuve qui la contredit.
      { id: 'a-deja-liee', site_id: SITE, report_id: REPORT, canonical_subject_id: 'cs-eau', subject_thread_id: null },
    ],

    site_deadlines: [
      // 4. « Démarrage du nettoyages » — aucun lien structurel, malgré une
      //    proposition ressemblante dans le même rapport.
      { id: 'd-nettoyage', site_id: SITE, report_id: REPORT, canonical_subject_id: null },
    ],

    document_proposal_materialization: [
      { proposal_id: 'dep-eau', target_entity_id: 'a-eau' },
      { proposal_id: 'dep-conflit', target_entity_id: 'a-conflit' },
    ],

    document_extraction_proposal: [
      { id: 'dep-eau', subject_thread_id: 'th-eau' },
      // Désigne un AUTRE sujet que le thread porté par l'action.
      { id: 'dep-conflit', subject_thread_id: 'th-eau' },
    ],

    site_knowledge_proposals: [
      { id: 'skp-cadenas', promoted_object_id: 'a-cadenas', canonical_subject_id: 'cs-cadenas' },
      { id: 'skp-deja-liee', promoted_object_id: 'a-deja-liee', canonical_subject_id: 'cs-autre' },
      // Proposition ressemblante à « Démarrage du nettoyages », mais ÉCARTÉE :
      // canonique résolu, jamais promue. Elle ne doit constituer aucune preuve.
      {
        id: 'skp-nettoyage-dismissed',
        promoted_object_id: null,
        canonical_subject_id: 'cs-nettoyage-panneaux',
        status: 'dismissed',
      },
    ],
  }
}

async function runProjection(dryRun = false) {
  const report = await projectCanonicalSubjectOnObjects({
    siteId: SITE,
    scope: { kind: 'report', reportId: REPORT },
    dryRun,
  })
  const projected = new Map(report.projected.map((p) => [p.objectId, p]))
  const skipped = new Map(report.skipped.map((s) => [s.objectId, s]))
  return { report, projected, skipped }
}

const fk = (table: 'site_actions' | 'site_deadlines', id: string) =>
  (TABLES[table].find((r) => r.id === id) as Row | undefined)?.canonical_subject_id ?? null

beforeEach(() => {
  TABLES = seed()
})

describe('projectCanonicalSubjectOnObjects — sentinelles PETRO', () => {
  it('1. Cadenas : la promotion terrain suffit à poser le lien', async () => {
    const { projected } = await runProjection()
    expect(projected.get('a-cadenas')?.canonicalSubjectId).toBe('cs-cadenas')
    expect(projected.get('a-cadenas')?.paths).toEqual(['promotion'])
    expect(fk('site_actions', 'a-cadenas')).toBe('cs-cadenas')
  })

  it('2. Eau panneaux : thread et matérialisation concordants, un seul lien', async () => {
    const { projected } = await runProjection()
    const row = projected.get('a-eau')
    expect(row?.canonicalSubjectId).toBe('cs-eau')
    // Les deux preuves sont conservées : elles se confirment, elles ne s'annulent pas.
    expect(row?.paths.sort()).toEqual(['materialization', 'thread'])
    expect(row?.mergeHops).toBe(0)
    expect(fk('site_actions', 'a-eau')).toBe('cs-eau')
  })

  it('3. Planning : aucune preuve structurelle, reste NULL', async () => {
    const { skipped } = await runProjection()
    expect(skipped.get('a-planning')?.reason).toBe('no_structural_evidence')
    expect(fk('site_actions', 'a-planning')).toBeNull()
  })

  it('4. « Démarrage du nettoyages » : proposition ressemblante mais écartée, reste NULL', async () => {
    const { skipped, projected } = await runProjection()
    expect(projected.has('d-nettoyage')).toBe(false)
    expect(skipped.get('d-nettoyage')?.reason).toBe('no_structural_evidence')
    expect(fk('site_deadlines', 'd-nettoyage')).toBeNull()
  })

  it('5. Cible fusionnée sur deux niveaux : écrit le vainqueur final, pas un perdant', async () => {
    const { projected } = await runProjection()
    const row = projected.get('a-fusion')
    expect(row?.rawSubjectId).toBe('cs-perdant-1')
    expect(row?.canonicalSubjectId).toBe('cs-vainqueur')
    expect(row?.mergeHops).toBe(2)
    expect(fk('site_actions', 'a-fusion')).toBe('cs-vainqueur')
  })

  it('6. Deux preuves contradictoires : aucune écriture, aucun arbitrage', async () => {
    const { skipped } = await runProjection()
    const row = skipped.get('a-conflit')
    expect(row?.reason).toBe('conflicting_evidence')
    expect(row?.targets.sort()).toEqual(['cs-cadenas', 'cs-eau'])
    expect(fk('site_actions', 'a-conflit')).toBeNull()
  })

  it('7. FK existante : jamais écrasée, même par une preuve divergente', async () => {
    const { skipped } = await runProjection()
    expect(skipped.get('a-deja-liee')?.reason).toBe('already_linked')
    expect(skipped.get('a-deja-liee')?.targets).toEqual(['cs-autre'])
    expect(fk('site_actions', 'a-deja-liee')).toBe('cs-eau')
  })
})

describe('projectCanonicalSubjectOnObjects — garanties transverses', () => {
  it('dryRun rapporte exactement les mêmes lignes sans rien écrire', async () => {
    const dry = await runProjection(true)
    expect(dry.report.dryRun).toBe(true)
    expect([...dry.projected.keys()].sort()).toEqual(['a-cadenas', 'a-eau', 'a-fusion'])
    for (const id of ['a-cadenas', 'a-eau', 'a-fusion']) expect(fk('site_actions', id)).toBeNull()

    TABLES = seed()
    const wet = await runProjection(false)
    expect([...wet.projected.keys()].sort()).toEqual([...dry.projected.keys()].sort())
  })

  it('est idempotent : un second passage ne projette plus rien', async () => {
    await runProjection()
    const second = await runProjection()
    expect(second.report.projected).toHaveLength(0)
    expect(second.skipped.get('a-cadenas')?.reason).toBe('already_linked')
  })

  it('une chaîne de fusion cyclique ne produit aucune écriture', async () => {
    const subjects = TABLES.canonical_subject
    ;(subjects.find((s) => s.id === 'cs-vainqueur') as Row).status = 'merged'
    ;(subjects.find((s) => s.id === 'cs-vainqueur') as Row).merged_into = 'cs-perdant-1'
    const { skipped } = await runProjection()
    expect(skipped.get('a-fusion')?.reason).toBe('merge_chain_unresolved')
    expect(fk('site_actions', 'a-fusion')).toBeNull()
  })

  it('ne touche jamais un objet hors du périmètre demandé', async () => {
    TABLES.site_actions.push({
      id: 'a-autre-rapport',
      site_id: SITE,
      report_id: 'report-autre',
      canonical_subject_id: null,
      subject_thread_id: 'th-eau',
    })
    await runProjection()
    expect(fk('site_actions', 'a-autre-rapport')).toBeNull()
  })
})
