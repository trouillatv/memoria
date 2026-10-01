import { describe, it, expect } from 'vitest'
import {
  duid,
  SEED_KEY,
  ORG_ID,
  SITE_ID,
  PROTECTED_ORGS,
  assertSafeOrgId,
  assertOrgIdPresent,
  assertRollbackEligible,
  ROLLBACK_TABLES,
  buildPlanSummary,
  EVENTS,
  ALLOWED_VISIT_MOTIVES,
  ACTIONS,
  SUBJECTS,
  LIVE_SUBJECTS,
} from './demo-architect-koutio-seed'

describe('demo-architect-koutio-seed — duid()', () => {
  it('est déterministe : même clé -> même uuid, sur plusieurs appels', () => {
    const a = duid('org:atelier-bouvier-demo')
    const b = duid('org:atelier-bouvier-demo')
    expect(a).toBe(b)
  })

  it('produit des uuids différents pour des clés différentes', () => {
    expect(duid('client:sci-koutio-horizon')).not.toBe(duid('site:koutio-horizon'))
  })

  it('produit un format UUID v4 valide (version=4, variant RFC4122)', () => {
    const id = duid('subject:b302-terrasse')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("ORG_ID exporté est bien duid('org:atelier-bouvier-demo') sous la SEED_KEY courante", () => {
    expect(SEED_KEY).toBe('koutio-horizon-v1')
    expect(ORG_ID).toBe(duid('org:atelier-bouvier-demo'))
  })
})

describe('demo-architect-koutio-seed — garde-fous orgs protégées', () => {
  it('refuse les 3 organisations protégées (CAPSE NC, CAPSE Démonstration, BatiSud Construction)', () => {
    for (const id of Object.keys(PROTECTED_ORGS)) {
      expect(() => assertSafeOrgId(id, 'test')).toThrow(/GUARDRAIL/)
    }
    expect(Object.keys(PROTECTED_ORGS)).toHaveLength(3)
  })

  it("n'empêche pas l'organisation démo calculée (ORG_ID) — elle n'est pas dans la liste protégée", () => {
    expect(() => assertSafeOrgId(ORG_ID, 'test')).not.toThrow()
  })

  it('refuse un organization_id manquant (null/undefined/vide)', () => {
    expect(() => assertOrgIdPresent(null, 'test')).toThrow(/GUARDRAIL/)
    expect(() => assertOrgIdPresent(undefined, 'test')).toThrow(/GUARDRAIL/)
    expect(() => assertOrgIdPresent('', 'test')).toThrow(/GUARDRAIL/)
  })

  it('accepte un organization_id présent', () => {
    expect(() => assertOrgIdPresent(ORG_ID, 'test')).not.toThrow()
  })
})

describe('demo-architect-koutio-seed — structure du dry-run (buildPlanSummary)', () => {
  it("référence l'organisation cible et la seed key, jamais une organisation protégée", () => {
    const lines = buildPlanSummary()
    const text = lines.join('\n')
    expect(text).toContain(ORG_ID)
    expect(text).toContain(SEED_KEY)
    for (const protectedId of Object.keys(PROTECTED_ORGS)) {
      expect(text).not.toContain(protectedId)
    }
  })

  it('annonce explicitement qu’aucune photo/document/storage n’est créé (interdit en Phase B1)', () => {
    const text = buildPlanSummary().join('\n')
    expect(text).toMatch(/Photos.*AUCUN/)
  })

  it('les compteurs actions done/open/en retard/cancelled sont cohérents et non négatifs', () => {
    const text = buildPlanSummary().join('\n')
    const m = text.match(/dont done=(\d+), open=(\d+) \(en retard=(\d+)\), cancelled=(\d+)/)
    expect(m).not.toBeNull()
    const [, done, open, late, cancelled] = m!.map(Number) as unknown as [never, number, number, number, number]
    expect(done).toBeGreaterThan(0)
    expect(open).toBeGreaterThanOrEqual(late)
    expect(cancelled).toBeGreaterThanOrEqual(0)
  })
})

describe('demo-architect-koutio-seed — rollback réel (assertRollbackEligible) fail-closed', () => {
  const validOrg = { id: ORG_ID, name: 'Atelier Bouvier — Démonstration', is_demo: true, demo_seed_key: SEED_KEY }

  it('accepte l’organisation démo calculée quand elle est is_demo=true et porte la bonne demo_seed_key', () => {
    expect(() => assertRollbackEligible(validOrg)).not.toThrow()
  })

  it('refuse CAPSE NC même si on lui attribue frauduleusement is_demo=true et la bonne seed_key', () => {
    const capseNcId = Object.keys(PROTECTED_ORGS).find((id) => PROTECTED_ORGS[id] === 'CAPSE NC')!
    expect(() =>
      assertRollbackEligible({ id: capseNcId, is_demo: true, demo_seed_key: SEED_KEY }),
    ).toThrow(/GUARDRAIL ROLLBACK/)
  })

  it('refuse CAPSE Démonstration même si on lui attribue frauduleusement is_demo=true et la bonne seed_key', () => {
    const capseDemoId = Object.keys(PROTECTED_ORGS).find((id) => PROTECTED_ORGS[id] === 'CAPSE Démonstration')!
    expect(() =>
      assertRollbackEligible({ id: capseDemoId, is_demo: true, demo_seed_key: SEED_KEY }),
    ).toThrow(/GUARDRAIL ROLLBACK/)
  })

  it('refuse BatiSud Construction même si on lui attribue frauduleusement is_demo=true et la bonne seed_key', () => {
    const batiSudId = Object.keys(PROTECTED_ORGS).find((id) => PROTECTED_ORGS[id] === 'BatiSud Construction')!
    expect(() =>
      assertRollbackEligible({ id: batiSudId, is_demo: true, demo_seed_key: SEED_KEY }),
    ).toThrow(/GUARDRAIL ROLLBACK/)
  })

  it('refuse une organisation sans is_demo=true (false, null, undefined)', () => {
    expect(() => assertRollbackEligible({ ...validOrg, is_demo: false })).toThrow(/GUARDRAIL ROLLBACK/)
    expect(() => assertRollbackEligible({ ...validOrg, is_demo: null })).toThrow(/GUARDRAIL ROLLBACK/)
    expect(() => assertRollbackEligible({ ...validOrg, is_demo: undefined as unknown as boolean })).toThrow(
      /GUARDRAIL ROLLBACK/,
    )
  })

  it('refuse une organisation avec une mauvaise demo_seed_key (autre seed, ou null)', () => {
    expect(() => assertRollbackEligible({ ...validOrg, demo_seed_key: 'autre-seed-v1' })).toThrow(
      /GUARDRAIL ROLLBACK/,
    )
    expect(() => assertRollbackEligible({ ...validOrg, demo_seed_key: null })).toThrow(/GUARDRAIL ROLLBACK/)
  })

  it("refuse tout organization_id différent de l'UUID déterministe attendu — aucun autre id ne peut entrer dans le scope", () => {
    const foreignId = duid('org:un-autre-tenant-quelconque')
    expect(foreignId).not.toBe(ORG_ID)
    expect(() =>
      assertRollbackEligible({ id: foreignId, is_demo: true, demo_seed_key: SEED_KEY }),
    ).toThrow(/GUARDRAIL ROLLBACK/)
  })

  it('UUID déterministes identiques entre le plan de seed et le scope de rollback (même ORG_ID/SITE_ID, aucun LIKE/wildcard)', () => {
    for (const t of ROLLBACK_TABLES) {
      expect(t.where).not.toMatch(/LIKE|%/)
      expect(t.where).toMatch(new RegExp(`'(${ORG_ID}|${SITE_ID})'`))
    }
    // La clause organizations référence bien l'ORG_ID déterministe de ce seed, pas un nom.
    const orgTable = ROLLBACK_TABLES.find((t) => t.table === 'public.organizations')!
    expect(orgTable.where).toBe(`id = '${ORG_ID}'`)
  })

  it('le scope organization_memberships est filtré uniquement par organization_id, jamais par user_id — les autres memberships de David ne sont jamais touchés', () => {
    const membershipTable = ROLLBACK_TABLES.find((t) => t.table === 'public.organization_memberships')!
    expect(membershipTable.where).toBe(`organization_id = '${ORG_ID}'`)
    expect(membershipTable.where).not.toMatch(/user_id/)
  })
})

describe('demo-architect-koutio-seed — EVENTS.visitMotive natif uniquement', () => {
  it("ALLOWED_VISIT_MOTIVES porte exactement les 14 valeurs natives (contrainte DB site_reports_visit_motive_check, migration 186 — additive sur 162 — et MOTIVES d'app/(field)/m/site/[siteId]/visit-actions.ts)", () => {
    expect(ALLOWED_VISIT_MOTIVES).toEqual([
      'inspection', 'controle', 'reunion', 'avancement', 'reception',
      'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre',
      'premiere', 'previsite_ao', 'prereception', 'sav',
    ])
  })

  it('les 12 événements du seed utilisent uniquement des visit_motive natifs (aucune valeur inventée)', () => {
    expect(EVENTS).toHaveLength(12)
    for (const ev of EVENTS) {
      expect(ALLOWED_VISIT_MOTIVES).toContain(ev.visitMotive)
    }
  })
})

describe('demo-architect-koutio-seed — FIX_REQUIRED : deux couches de sujets distinctes (public.subjects vs canonical_subject)', () => {
  it('A. les 5 ids LIVE_SUBJECTS sont distincts des 5 ids SUBJECTS (canoniques) — aucune collision entre les deux couches', () => {
    const keys = Object.keys(SUBJECTS) as Array<keyof typeof SUBJECTS>
    expect(keys).toHaveLength(5)
    expect(Object.keys(LIVE_SUBJECTS)).toHaveLength(5)
    for (const k of keys) {
      expect(LIVE_SUBJECTS[k]).not.toBe(SUBJECTS[k])
    }
    const allIds = [...keys.map((k) => SUBJECTS[k]), ...keys.map((k) => LIVE_SUBJECTS[k])]
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('B. chaque événement avec targetSubject résout vers LIVE_SUBJECTS (jamais SUBJECTS) pour site_reports.target_subject_id', () => {
    const withTarget = EVENTS.filter((ev) => ev.targetSubject)
    expect(withTarget.length).toBeGreaterThan(0)
    for (const ev of withTarget) {
      const key = ev.targetSubject as keyof typeof SUBJECTS
      const resolved = LIVE_SUBJECTS[key]
      expect(resolved).toBeDefined()
      expect(resolved).not.toBe(SUBJECTS[key])
    }
  })

  it('C. chaque action avec subject porte à la fois subject_id (vivant) et canonical_subject_id (mémoire), et les deux diffèrent', () => {
    const withSubject = ACTIONS.filter((a) => a.subject)
    expect(withSubject.length).toBeGreaterThan(0)
    for (const a of withSubject) {
      const key = a.subject as keyof typeof SUBJECTS
      const liveId = LIVE_SUBJECTS[key]
      const canonicalId = SUBJECTS[key]
      expect(liveId).toBeDefined()
      expect(canonicalId).toBeDefined()
      expect(liveId).not.toBe(canonicalId)
    }
  })

  it('D. les 3 réunions (report:05/08/12) ont origin=null — jamais traitées comme une visite terrain', () => {
    const meetingKeys = ['report:05', 'report:08', 'report:12']
    const meetings = EVENTS.filter((ev) => meetingKeys.includes(ev.key))
    expect(meetings).toHaveLength(3)
    for (const ev of meetings) {
      expect(ev.origin).toBeNull()
    }
  })

  it('E. les 9 autres événements (visites/contrôles) portent une origine de visite terrain non nulle', () => {
    const meetingKeys = ['report:05', 'report:08', 'report:12']
    const visits = EVENTS.filter((ev) => !meetingKeys.includes(ev.key))
    expect(visits).toHaveLength(9)
    for (const ev of visits) {
      expect(ev.origin).not.toBeNull()
      expect(['planned', 'spontaneous', 'qr', 'gps']).toContain(ev.origin)
    }
  })

  it('F. ROLLBACK_TABLES couvre public.subjects, scopé par site_id (même pattern que canonical_subject, aucun LIKE/wildcard)', () => {
    const subjectsTable = ROLLBACK_TABLES.find((t) => t.table === 'public.subjects')
    expect(subjectsTable).toBeDefined()
    expect(subjectsTable!.where).toBe(`site_id = '${SITE_ID}'`)
    expect(subjectsTable!.where).not.toMatch(/LIKE|%/)
  })

  it('G. ACTIONS compte exactement 30 éléments', () => {
    expect(ACTIONS).toHaveLength(30)
  })
})
