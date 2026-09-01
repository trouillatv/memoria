// Point 9+10A — activité du chantier ≠ activité personnelle de l'utilisateur.
//
// Trois garanties :
//  1. « Chantiers récents » (listRecentSitesForUser) exclut les imports : une
//     ingestion documentaire n'est pas une venue personnelle. Les réunions
//     (origin NULL) et visites terrain restent — un `.neq('origin','import')` SQL
//     les aurait droppées par la logique tri-valuée, d'où le filtre JS.
//  2. SinceLastVisitCard : le possessif « votre » n'apparaît que si personal=true.
//  3. WatchedSites : libellé « dernière activité » (la donnée inclut des imports),
//     jamais « dernière visite ».

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Comportemental : exclusion des imports dans « Chantiers récents » ──────────

let reports: Array<{ site_id: string; created_at: string; started_at: string | null; ended_at: string | null; origin: string | null }> = []
let sitesData: Array<{ id: string; name: string }> = []

function thenable(data: unknown) {
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b, eq: () => b, not: () => b, order: () => b, limit: () => b, in: () => b,
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
  })
  return b
}

const fakeClient = {
  from: (table: string) => {
    if (table === 'site_reports') return thenable(reports)
    if (table === 'sites') return thenable(sitesData)
    return thenable([]) // site_reserve
  },
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient }))
vi.mock('@/lib/db/site-actions', () => ({ listOpenSiteActions: async () => [] }))

const { listRecentSitesForUser } = await import('@/lib/db/visits')

beforeEach(() => { reports = []; sitesData = [] })

describe('listRecentSitesForUser — récent = interaction personnelle, pas import', () => {
  it('exclut origin=import, conserve visite terrain ET réunion (origin NULL)', async () => {
    // Le plus récent est un IMPORT : sans filtre il serait en tête. Il doit disparaître.
    reports = [
      { site_id: 's-import',  origin: 'import',      created_at: '2026-09-03T00:00:00Z', started_at: null, ended_at: null },
      { site_id: 's-terrain', origin: 'spontaneous', created_at: '2026-09-02T00:00:00Z', started_at: null, ended_at: '2026-09-02T05:00:00Z' },
      { site_id: 's-reunion', origin: null,          created_at: '2026-09-01T00:00:00Z', started_at: null, ended_at: null },
    ]
    sitesData = [{ id: 's-terrain', name: 'Terrain' }, { id: 's-reunion', name: 'Réunion' }]

    const out = await listRecentSitesForUser('u1')
    const ids = out.map((s) => s.siteId)

    expect(ids).not.toContain('s-import')
    expect(ids).toContain('s-terrain')
    expect(ids).toContain('s-reunion')
  })

  it('un chantier où l’utilisateur n’a fait QU’un import n’apparaît pas', async () => {
    reports = [
      { site_id: 's-import-only', origin: 'import', created_at: '2026-09-03T00:00:00Z', started_at: null, ended_at: null },
    ]
    sitesData = []
    const out = await listRecentSitesForUser('u1')
    expect(out).toHaveLength(0)
  })
})

// ── Doctrine : libellés honnêtes (verrouillés contre régression) ──────────────

function read(p: string): string {
  return readFileSync(join(process.cwd(), p), 'utf8')
}

describe('SinceLastVisitCard — possessif seulement si personal', () => {
  const src = read('app/(field)/m/site/[siteId]/SinceLastVisitCard.tsx')
  it('l’état vide conditionne « votre passage » à delta.personal, sinon « la dernière visite »', () => {
    expect(src).toContain("delta.personal ? 'votre passage' : 'la dernière visite'")
    // Plus de « votre passage » écrit en dur sans condition.
    expect(src).not.toMatch(/depuis votre passage du \{delta\.visitDateLabel\}/)
  })
})

describe('WatchedSites — « dernière activité », pas « dernière visite »', () => {
  const src = read('app/(dashboard)/dashboard/WatchedSites.tsx')
  it('affiche « dernière activité » (la donnée lastActivityAt inclut des imports)', () => {
    expect(src).toContain('dernière activité ')
    expect(src, 'lastActivityAt n’est pas une visite : ne pas l’étiqueter ainsi').not.toContain('dernière visite ')
  })
})
