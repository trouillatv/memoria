// LOT CANONICAL READ-MODEL 1 — getCompanyFiche.subjectsCarried lit désormais
// site_actions.canonical_subject_id (route structurelle prouvée par l'audit
// transversal), plus jamais le subject_id legacy. Aucun matching, aucun
// fallback : une action canonique orpheline reste honnêtement sans sujet.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const run = () => {
      const rows = tables[table] ?? []
      return rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
    }
    const api = {
      select: () => api,
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

import { getCompanyFiche } from '@/lib/db/company-fiche'

const ORG = 'org-1'
const SITE = 'site-1'
const COMPANY = 'co-lylo'

function seed(): Tables {
  return {
    companies: [
      { id: COMPANY, name: 'Lylo SARL', short_name: 'Lylo', is_placeholder: false, deleted_at: null, organization_id: ORG, siret: null, address: null, postal_code: null, city: null, phone: null, email: null, website: null },
    ],
    site_intervenants: [],
    company_contacts: [],
    sites: [{ id: SITE, name: 'RUS' }],
    canonical_subject: [
      { id: 'cs-consignes', label: 'Consignes d’exploitation' },
    ],
    site_actions: [
      // Action pilotée par la route canonique — doit apparaître.
      { id: 'a-consignes', title: 'Vérifier les consignes Lylo', site_id: SITE, status: 'open', assigned_company_id: COMPANY, assigned_contact_id: null, due_date: null, canonical_subject_id: 'cs-consignes', subject_id: null },
      // Action legacy pure : subject_id peuplé, canonical_subject_id absent — ne doit plus piloter la projection.
      { id: 'a-legacy', title: 'Ancienne action liée en legacy', site_id: SITE, status: 'open', assigned_company_id: COMPANY, assigned_contact_id: null, due_date: null, canonical_subject_id: null, subject_id: 'legacy-subject-id' },
      // Action canonique orpheline : canonical_subject_id NULL — doit rester sans sujet, jamais inventé.
      { id: 'a-orpheline', title: 'Demander le programme de maintien des acquis à Lylo', site_id: SITE, status: 'open', assigned_company_id: COMPANY, assigned_contact_id: null, due_date: null, canonical_subject_id: null, subject_id: null },
    ],
  }
}

beforeEach(() => {
  TABLES = seed()
})

describe('getCompanyFiche — subjectsCarried route canonique (LOT CANONICAL READ-MODEL 1)', () => {
  it('une action avec canonical_subject_id apparaît dans subjectsCarried, résolue via canonical_subject', async () => {
    const fiche = await getCompanyFiche(COMPANY, [ORG])
    expect(fiche).not.toBeNull()
    const s = fiche!.subjectsCarried.find((r) => r.subjectId === 'cs-consignes')
    expect(s).toBeDefined()
    expect(s!.subjectName).toBe('Consignes d’exploitation')
    expect(s!.href).toBe(`/sites/${SITE}/historique/sujets/cs-consignes`)
  })

  it('une action avec seulement subject_id legacy ne pilote plus la projection (aucun sujet fabriqué depuis legacy-subject-id)', async () => {
    const fiche = await getCompanyFiche(COMPANY, [ORG])
    const ids = fiche!.subjectsCarried.map((r) => r.subjectId)
    expect(ids).not.toContain('legacy-subject-id')
    expect(ids).toEqual(['cs-consignes'])
  })

  it('une action canonique orpheline (canonical_subject_id = null) ne reçoit aucun sujet inventé', async () => {
    const fiche = await getCompanyFiche(COMPANY, [ORG])
    // L'orpheline (a-orpheline) ne contribue à aucune entrée de subjectsCarried.
    expect(fiche!.subjectsCarried).toHaveLength(1)
    expect(fiche!.actions.some((a) => a.id === 'a-orpheline')).toBe(true) // reste visible comme action ouverte
  })
})
