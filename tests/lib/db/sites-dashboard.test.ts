// MEMORIA-HOME-V2 — tests de lib/db/sites-dashboard.ts.
//
// Couvre :
//   - Selection : isSiteAccessible (Correction B) + préfixage ensureSiteId, max `limit` cartes
//   - Logos : Correction A — organizationFor résout le logo depuis la map fournie, même mono-org
//   - Counters / Performance : pvCount/subjectCount batchés, UNE requête par table quel que soit
//     le nombre de chantiers — jamais une boucle par site

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}
let CALL_LOG: string[] = []

function makeAdmin(tables: Tables, callLog: string[]) {
  function builder(table: string) {
    callLog.push(table)
    const filters: Array<(r: Row) => boolean> = []
    let orderSpec: { field: string; ascending: boolean } | null = null
    let limitN: number | null = null
    const rows = () => {
      let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
      if (orderSpec) {
        const { field, ascending } = orderSpec
        out = [...out].sort((a, b) => {
          const av = a[field] as string | number
          const bv = b[field] as string | number
          if (av === bv) return 0
          return ascending ? (av < bv ? -1 : 1) : av > bv ? -1 : 1
        })
      }
      if (limitN != null) out = out.slice(0, limitN)
      return out
    }
    const api = {
      select: () => api,
      in: (f: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[f])), api),
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      not: (f: string, _op: string, v: unknown) =>
        (filters.push((r) => (v === null ? r[f] != null : r[f] !== v)), api),
      gt: (f: string, v: unknown) =>
        (filters.push((r) => r[f] != null && (r[f] as string) > (v as string)), api),
      order: (f: string, opts?: { ascending?: boolean }) => ((orderSpec = { field: f, ascending: opts?.ascending !== false }), api),
      limit: (n: number) => ((limitN = n), api),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES, CALL_LOG) as never,
}))

import { isSiteAccessible, getSitesDashboard } from '@/lib/db/sites-dashboard'
import type { OrganizationIdentityMap } from '@/lib/db/organisations'

function site(id: string, organizationId: string, over: Partial<Row> = {}): Row {
  return { id, name: id, organization_id: organizationId, client_id: null, deleted_at: null, ...over }
}

beforeEach(() => {
  CALL_LOG = []
  TABLES = {
    sites: [
      site('site-1', 'org-a'),
      site('site-2', 'org-a'),
      site('site-3', 'org-b'),
      site('site-4', 'org-a'),
      site('site-5', 'org-a'),
      site('site-6', 'org-a'),
    ],
    clients: [],
    site_actions: [],
    site_reserve: [],
    site_reports: [],
    subject_thread_identity: [],
    document_extraction_proposal: [],
    documents: [],
    site_scheduled_events: [],
  }
})

describe('isSiteAccessible — Correction B (validation contre TOUS les chantiers accessibles)', () => {
  it('site dans un org accessible → true', async () => {
    expect(await isSiteAccessible('site-1', ['org-a'])).toBe(true)
  })

  it('site hors périmètre (autre organisation) → false, ne révèle rien', async () => {
    expect(await isSiteAccessible('site-3', ['org-a'])).toBe(false)
  })

  it('site supprimé → false même si l\'org est accessible', async () => {
    TABLES.sites!.push(site('site-deleted', 'org-a', { deleted_at: '2026-01-01T00:00:00Z' }))
    expect(await isSiteAccessible('site-deleted', ['org-a'])).toBe(false)
  })

  it('siteId vide → false sans requête', async () => {
    const before = CALL_LOG.length
    expect(await isSiteAccessible('', ['org-a'])).toBe(false)
    expect(CALL_LOG.length).toBe(before)
  })

  it('aucun org accessible → false sans requête', async () => {
    const before = CALL_LOG.length
    expect(await isSiteAccessible('site-1', [])).toBe(false)
    expect(CALL_LOG.length).toBe(before)
  })
})

describe('getSitesDashboard — Correction A (logo résolu depuis la map, même mono-org)', () => {
  it('mono-org avec map fournie → logoUrl réel, pas un repli null', async () => {
    const organizationMap: OrganizationIdentityMap = {
      'org-a': { id: 'org-a', name: 'Org A', slug: 'org-a', logoPath: 'p.png', logoUrl: 'https://signed/p.png', brandColor: null },
    }
    TABLES.sites = [site('site-1', 'org-a')]
    const result = await getSitesDashboard(['org-a'], organizationMap)
    expect(result[0]?.organization.logoUrl).toBe('https://signed/p.png')
  })

  it('org absente de la map → repli explicite (logoUrl null), jamais une exception', async () => {
    TABLES.sites = [site('site-1', 'org-a')]
    const result = await getSitesDashboard(['org-a'], {})
    expect(result[0]?.organization.logoUrl).toBeNull()
    expect(result[0]?.organization.name).toBe('org-a')
  })
})

describe('getSitesDashboard — Counters/Performance (batché, jamais une requête par chantier)', () => {
  it('pvCount/subjectCount reproduisent getSiteSubjectMatrix (merge canonique + ungrouped), UNE requête par table quel que soit le nombre de chantiers', async () => {
    TABLES.site_reports = [
      { site_id: 'site-1', extraction_run_id: 'run-1', source_document_id: 'doc-1', ended_at: null, planned_at: null },
      { site_id: 'site-1', extraction_run_id: 'run-2', source_document_id: 'doc-2', ended_at: null, planned_at: null },
      // run-3 pointe vers un document supprimé → ne doit PAS compter
      { site_id: 'site-1', extraction_run_id: 'run-3', source_document_id: 'doc-deleted', ended_at: null, planned_at: null },
      { site_id: 'site-2', extraction_run_id: 'run-9', source_document_id: 'doc-9', ended_at: null, planned_at: null },
    ]
    TABLES.documents = [{ id: 'doc-deleted', deleted_at: '2026-01-01T00:00:00Z' }]
    TABLES.document_extraction_proposal = [
      // site-1 : thread-a et thread-b partagent le même canonical → 1 seule ligne fusionnée
      { extraction_run_id: 'run-1', subject_thread_id: 'thread-a' },
      { extraction_run_id: 'run-2', subject_thread_id: 'thread-b' },
      // site-1 : thread-c n'a aucun lien canonique → compté individuellement (ungrouped)
      { extraction_run_id: 'run-2', subject_thread_id: 'thread-c' },
      // run-3 est exclu (document supprimé) → thread-deleted ne doit jamais compter
      { extraction_run_id: 'run-3', subject_thread_id: 'thread-deleted' },
      // site-2 : thread isolé, ne doit jamais contaminer le compte de site-1
      { extraction_run_id: 'run-9', subject_thread_id: 'thread-z' },
    ]
    TABLES.subject_thread_identity = [
      { subject_thread_id: 'thread-a', canonical_subject_id: 'cs-1' },
      { subject_thread_id: 'thread-b', canonical_subject_id: 'cs-1' }, // même canonical que thread-a → fusion
      { subject_thread_id: 'thread-z', canonical_subject_id: 'cs-1' }, // même canonical_subject_id mais site-2 → isolation
      // thread-c volontairement absent : aucun lien canonique → ungrouped
    ]

    const result = await getSitesDashboard(['org-a'], {}, { limit: 6 })
    const s1 = result.find((r) => r.id === 'site-1')
    const s2 = result.find((r) => r.id === 'site-2')
    expect(s1?.pvCount).toBe(2)
    // thread-a+thread-b fusionnés (cs-1) = 1, thread-c ungrouped = 1 → 2
    expect(s1?.subjectCount).toBe(2)
    // cs-1 réapparaît pour site-2 via thread-z, mais reste isolé par chantier → 1
    expect(s2?.subjectCount).toBe(1)

    // Table interrogée une fois pour l'activité/agenda, une fois pour les compteurs PV — jamais une fois par site.
    expect(CALL_LOG.filter((t) => t === 'site_reports')).toHaveLength(2)
    expect(CALL_LOG.filter((t) => t === 'document_extraction_proposal')).toHaveLength(1)
    expect(CALL_LOG.filter((t) => t === 'subject_thread_identity')).toHaveLength(1)
    expect(CALL_LOG.filter((t) => t === 'documents')).toHaveLength(1)
    expect(CALL_LOG.filter((t) => t === 'site_actions')).toHaveLength(1)
    expect(CALL_LOG.filter((t) => t === 'site_reserve')).toHaveLength(1)
    expect(CALL_LOG.filter((t) => t === 'site_scheduled_events')).toHaveLength(1)
  })
})

describe('getSitesDashboard — Selection (max `limit` cartes, chantier actif toujours présent)', () => {
  it('sans ensureSiteId, tronque au `limit` demandé', async () => {
    const result = await getSitesDashboard(['org-a'], {}, { limit: 3 })
    expect(result).toHaveLength(3)
  })

  it("ensureSiteId hors du top naturel est préfixé sans dépasser `limit`", async () => {
    // Aucun signal de tri (actions/réserves) → ordre alphabétique par nom : site-1..site-6.
    // Le top naturel à limit=3 est site-1/2/4 (org-a uniquement, site-3 est org-b).
    const result = await getSitesDashboard(['org-a'], {}, { limit: 3, ensureSiteId: 'site-6' })
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe('site-6')
    expect(result.some((r) => r.id === 'site-6')).toBe(true)
  })

  it('ensureSiteId déjà dans le top naturel ne duplique rien', async () => {
    const result = await getSitesDashboard(['org-a'], {}, { limit: 3, ensureSiteId: 'site-1' })
    expect(result).toHaveLength(3)
    expect(result.filter((r) => r.id === 'site-1')).toHaveLength(1)
  })
})
