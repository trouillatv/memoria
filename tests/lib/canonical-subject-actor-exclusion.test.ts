import { describe, it, expect, vi } from 'vitest'

// P1-C1a — Bug A : un fait métier ne doit jamais se résoudre sur un canonical_subject
// représentant un ACTEUR (kind='actor'). Ces tests prouvent (a) la garde pure
// excludeActorSubjectsFromPool, (b) l'effet sur le resolver déterministe pour les 7 cas
// réels Bella Napoli, (c) que le chemin acteur légitime (proposition company) reste intact.

import {
  excludeActorSubjectsFromPool,
  matchCanonicalSubjects,
} from '@/lib/db/canonical-subject-resolve'

type Sub = { id: string; label: string; aliases: string[] | null; kind: 'actor' | 'business_subject' }

const ACTORS: Sub[] = [
  { id: 'kft', label: 'KFT', aliases: null, kind: 'actor' },
  { id: 'bv', label: 'Bureau Veritas', aliases: null, kind: 'actor' },
  { id: 'mies', label: 'MIES', aliases: null, kind: 'actor' },
  { id: 'dscgr', label: 'DSCGR', aliases: null, kind: 'actor' },
  { id: 'capse', label: 'CAPSE NC', aliases: null, kind: 'actor' },
  { id: 'vela', label: 'Velayoudon', aliases: null, kind: 'actor' },
  { id: 'vhz', label: 'VHZ réfrigération', aliases: null, kind: 'actor' },
]

// Requêtes = libellé réel du fait métier (Bella Napoli 2024/2025).
const CASES: { name: string; q: string; actorId: string }[] = [
  { name: 'KFT / nettoyage', actorId: 'kft', q: "Nettoyage des conduits d'extraction d'air vicié, de buée et de graisse réalisé par KFT en 11/2022" },
  { name: 'Bureau Veritas / cuisson', actorId: 'bv', q: 'Appareils de cuisson et/ou de remise en température contrôlés par Bureau Veritas le 25/03/2022' },
  { name: 'MIES / friteuse', actorId: 'mies', q: "Système d'extinction automatique (friteuse) contrôlé par MIES en 11/2022 (remise en état)" },
  { name: 'DSCGR / issue Mall', actorId: 'dscgr', q: "Validation que l'issue donnant sur le mall est suffisante pour évacuer le public, réservée au personnel" },
  { name: 'CAPSE NC / panneau', actorId: 'capse', q: 'Mise en place d’un panneau « entrée interdite au public » associé à un marquage au sol' },
  { name: 'Velayoudon / huiles', actorId: 'vela', q: 'Récupération des huiles usagées' },
  { name: 'VHZ / climatisation', actorId: 'vhz', q: 'Contrôles climatisation réalisés' },
]

describe('excludeActorSubjectsFromPool', () => {
  it('retire les sujets kind=actor et conserve les sujets métier', () => {
    const pool: Sub[] = [
      ...ACTORS,
      { id: 'm1', label: 'Nettoyage conduits', aliases: null, kind: 'business_subject' },
    ]
    const filtered = excludeActorSubjectsFromPool(pool)
    expect(filtered.map((s) => s.id)).toEqual(['m1'])
    expect(filtered.some((s) => s.kind === 'actor')).toBe(false)
  })

  it('conserve les lignes sans kind (héritage) — jamais retirées par erreur', () => {
    const legacy: Array<{ id: string; label: string; aliases: null; kind?: string }> = [
      { id: 'x', label: 'Sujet legacy', aliases: null },
    ]
    expect(excludeActorSubjectsFromPool(legacy)).toHaveLength(1)
  })
})

describe('Bug A — le fait métier ne se résout jamais sur l’acteur après exclusion', () => {
  // Preuve du bug sur le seul cas déterministe (ancre lexicale « Veritas » ≥ 7 car.).
  it('AVANT (pool avec acteurs) : cuisson → résolu sur l’acteur Bureau Veritas (régression témoin)', () => {
    const r = matchCanonicalSubjects(CASES[1].q, ACTORS)
    expect(r.kind).toBe('resolved')
    if (r.kind === 'resolved') expect(r.candidate.id).toBe('bv')
  })

  it('APRÈS (pool filtré) : aucun des 7 faits ne se résout sur un acteur', () => {
    const filtered = excludeActorSubjectsFromPool(ACTORS) // → pool vide d’acteurs
    for (const c of CASES) {
      const r = matchCanonicalSubjects(c.q, filtered)
      // pool sans acteur → jamais resolved sur l’acteur (ici not_found → Phase 2 créera le sujet métier)
      if (r.kind === 'resolved') {
        expect(r.candidate.id).not.toBe(c.actorId)
      }
      expect(filtered.some((s) => s.id === c.actorId)).toBe(false)
    }
  })

  it('APRÈS : le fait rejoint le vrai sujet métier quand il existe (KFT / nettoyage)', () => {
    const pool: Sub[] = [
      ...ACTORS,
      { id: 'm-net', label: "Nettoyage conduits d'extraction d'air vicié/buée/graisse", aliases: null, kind: 'business_subject' },
    ]
    const filtered = excludeActorSubjectsFromPool(pool)
    const r = matchCanonicalSubjects(CASES[0].q, filtered)
    expect(r.kind).toBe('resolved')
    if (r.kind === 'resolved') expect(r.candidate.id).toBe('m-net')
  })
})

describe('cas génériques (format-agnostiques)', () => {
  it('nom d’entreprise long : « …par Bureau Veritas » exclu → pas de résolution acteur', () => {
    const filtered = excludeActorSubjectsFromPool(ACTORS)
    const r = matchCanonicalSubjects('Contrôle réalisé par Bureau Veritas le 10/01/2025', filtered)
    if (r.kind === 'resolved') expect(r.candidate.label).not.toBe('Bureau Veritas')
  })

  it('acronyme court : « …par SOCOTEC » — l’acteur est absent du pool métier', () => {
    const pool: Sub[] = [{ id: 'soc', label: 'SOCOTEC', aliases: null, kind: 'actor' }]
    const filtered = excludeActorSubjectsFromPool(pool)
    expect(filtered).toHaveLength(0)
    expect(matchCanonicalSubjects('Vérification des extincteurs par SOCOTEC', filtered).kind).toBe('not_found')
  })

  it('vrai sujet métier centré sur un acteur : « CAPSE doit transmettre le rapport » ne rejoint pas l’acteur', () => {
    const pool: Sub[] = [
      { id: 'capse', label: 'CAPSE NC', aliases: null, kind: 'actor' },
      { id: 'm-transmission', label: 'Transmission du rapport de sécurité', aliases: null, kind: 'business_subject' },
    ]
    const filtered = excludeActorSubjectsFromPool(pool)
    const r = matchCanonicalSubjects('CAPSE doit transmettre le rapport avant vendredi', filtered)
    if (r.kind === 'resolved') expect(r.candidate.id).not.toBe('capse')
  })

  it('deux entreprises aux labels proches sont toutes deux retirées du pool métier', () => {
    const pool: Sub[] = [
      { id: 'a', label: 'Bureau Veritas', aliases: null, kind: 'actor' },
      { id: 'b', label: 'Bureau Veritas NC', aliases: null, kind: 'actor' },
      { id: 'm', label: 'Contrôle réglementaire', aliases: null, kind: 'business_subject' },
    ]
    expect(excludeActorSubjectsFromPool(pool).map((s) => s.id)).toEqual(['m'])
  })
})

// ── resolveCanonicalSubjectReference : preuve bout-en-bout via admin mocké ─────
type FakeRow = { id: string; label: string; aliases: string[] | null; status: string; site_id: string; kind: string }

function makeAdminClientMock(rows: FakeRow[]) {
  function builder() {
    const filters: Array<(r: FakeRow) => boolean> = []
    const api = {
      select() { return api },
      update() { return api },
      eq(field: keyof FakeRow, value: unknown) { filters.push((r) => r[field] === value); return api },
      in(field: keyof FakeRow, values: unknown[]) { filters.push((r) => values.includes(r[field] as never)); return api },
      then(resolve: (result: { data: FakeRow[]; error: null }) => void) {
        resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
      },
    }
    return api
  }
  return { from() { return builder() } }
}

const SITE = 'site-1'
const ROWS: FakeRow[] = [
  { id: 'bv', label: 'Bureau Veritas', aliases: null, status: 'active', site_id: SITE, kind: 'actor' },
  { id: 'm-cuis', label: 'Appareils de cuisson', aliases: null, status: 'active', site_id: SITE, kind: 'business_subject' },
]

describe('resolveCanonicalSubjectReference — option excludeActorSubjects', () => {
  it('fait métier + excludeActorSubjects:true → ne résout PAS sur l’acteur', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdminClientMock(ROWS) }))
    const { resolveCanonicalSubjectReference } = await import('@/lib/db/canonical-subject-resolve')
    const r = await resolveCanonicalSubjectReference(SITE, 'Contrôle réalisé par Bureau Veritas le 10/01', { excludeActorSubjects: true })
    if (r.kind === 'resolved') expect(r.candidate.id).not.toBe('bv')
  })

  it('sans option (chemin acteur) → une proposition company retrouve bien son CS acteur', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdminClientMock(ROWS) }))
    const { resolveCanonicalSubjectReference } = await import('@/lib/db/canonical-subject-resolve')
    const r = await resolveCanonicalSubjectReference(SITE, 'Bureau Veritas')
    expect(r.kind).toBe('resolved')
    if (r.kind === 'resolved') expect(r.candidate.id).toBe('bv')
  })
})
