// Tests unitaires — buildSiteIntelligenceContext
//
// Cas couverts :
//  1. Option disabled → dimension absente du résultat
//  2. maxSubjects respecté
//  3. maxRelations respecté
//  4. maxAttentionItems respecté
//  5. maxActors respecté
//  6. IDs préservés sur subjects (canonicalSubjectId)
//  7. IDs préservés sur relations (linkId, fromCanonicalSubjectId)
//  8. IDs préservés sur actors (intervenantId, contactId)
//  9. IDs préservés sur activeObjects (actionId, reserveId, deadlineId, blocageId)
// 10. rejected exclu des relations (confirmé par listConfirmedLinksForSite)
// 11. Chantier vide — résultat propre sans crash
// 12. Aucun appel LLM ni retrieval documentaire (structurellement garanti)
// 13. meta.retrievalNeeded toujours false
// 14. meta.dimensionsLoaded cohérent avec les options activées

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import type { SiteAttentionItem } from '@/lib/knowledge/site-attention-items'
import type { SubjectThreadLink } from '@/lib/db/subject-thread-links'
import type { SiteIntervenantsView, IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'
import type { SiteBlocage } from '@/lib/db/site-blocages'

// ── Mocks des services ────────────────────────────────────────────────────────

vi.mock('@/lib/knowledge/site-attention-items', () => ({
  deriveSiteAttentionItems: vi.fn(),
}))

vi.mock('@/lib/db/canonical-subject-life', () => ({
  getNavigableSubjectsForSite: vi.fn(),
}))

vi.mock('@/lib/db/subject-thread-links', () => ({
  listConfirmedLinksForSite: vi.fn(),
}))

vi.mock('@/lib/knowledge/site-intervenants-view', () => ({
  getSiteIntervenantsView: vi.fn(),
}))

vi.mock('@/lib/db/site-blocages', () => ({
  listBlocagesBySite: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// ── Helpers de fixtures ───────────────────────────────────────────────────────

function makeSubject(overrides: Partial<NavigableSubjectSummary> = {}): NavigableSubjectSummary {
  return {
    canonicalSubjectId: 'cs-001',
    title: 'VRD — Reprises',
    aliases: [],
    durableKind: 'business_subject',
    dominantFamily: 'action',
    currentStatus: 'open',
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    lastMeaningfulChangeAt: '2026-06-01',
    pvCount: 3,
    threadCount: 1,
    nativeOccurrenceCount: 0,
    activeObjects: { actionsOpen: 2, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 2 },
    isStagnant: false,
    stagnationDays: 0,
    consecutiveMentionsWithoutChange: 0,
    terrainObjects: [],
    currentTriState: 'unknown',
    displayState: 'open',
    provenOpen: true,
    activeObjectsCboAware: 2,
    ...overrides,
  }
}

function makeAttentionItem(overrides: Partial<SiteAttentionItem> = {}): SiteAttentionItem {
  return {
    signal: 'subject_stagnant',
    title: 'VRD stagnant',
    reason: 'Pas d\'évolution depuis 60j',
    urgency: 'high',
    href: '/sites/site-1/historique/sujets/cs-001',
    ...overrides,
  }
}

function makeLink(overrides: Partial<SubjectThreadLink> = {}): SubjectThreadLink {
  return {
    id: 'link-001',
    siteId: 'site-1',
    fromThreadId: 'thread-A',
    toThreadId: 'thread-B',
    linkType: 'requires',
    status: 'confirmed',
    source: 'human',
    confidence: null,
    justification: 'La réception G3 nécessite la levée des réserves',
    createdBy: 'user-1',
    confirmedBy: 'user-1',
    confirmedAt: '2026-07-01T00:00:00Z',
    createdAt: '2026-07-01T00:00:00Z',
    evidenceRunId: null,
    evidenceProposalId: null,
    ...overrides,
  }
}

function makePerson(overrides: Partial<IntervenantPerson> = {}): IntervenantPerson {
  return {
    intervenantId: 'iv-001',
    contactId: 'contact-001',
    isPerson: true,
    name: 'Jean Dupont',
    fonction: 'Conducteur de travaux',
    role: 'Entreprise',
    companyId: 'company-1',
    companyName: 'PAVE',
    phone: null,
    mobile: null,
    email: null,
    firstSeen: '2026-01-01',
    lastActivity: '2026-07-01',
    citedVisits: [],
    mentionCount: 3,
    assignedActions: [],
    decisionsCount: 1,
    decisions: [{ id: 'dec-001', titre: 'Reprise VRD' }],
    openObligationsCount: 0,
    elsewhere: [],
    lifeline: [],
    ...overrides,
  }
}

function makeIntervenantsView(people: IntervenantPerson[] = []): SiteIntervenantsView {
  return {
    siteId: 'site-1',
    confirmedCount: people.length,
    toIdentifyCount: 0,
    companies: [...new Set(people.map((p) => p.companyName))],
    groups: people.length > 0
      ? [{
          companyId: people[0].companyId,
          companyName: people[0].companyName,
          roles: [people[0].role],
          people,
        }]
      : [],
    toIdentify: [],
  }
}

function makeBlocage(overrides: Partial<SiteBlocage> = {}): SiteBlocage {
  return {
    id: 'bloc-001',
    siteId: 'site-1',
    subjectId: null,
    type: 'intemperie',
    title: 'Pluies intenses',
    description: 'Coulées de boue sur le secteur A',
    impact: null,
    dateStart: '2026-07-15',
    dateEnd: null,
    sourceType: 'human',
    sourceReportId: null,
    dayLogId: null,
    ...overrides,
  }
}

// ── Mock Supabase admin ───────────────────────────────────────────────────────

interface TableFixtures {
  sites?: { name: string }
  subject_thread_identity?: Array<{ subject_thread_id: string; canonical_subject_id: string }>
  site_actions?: Array<{ id: string; title: string; due_date: string; subject_thread_id: string | null; assigned_to: string | null }>
  site_reserve?: Array<{ id: string; label: string; issued_on: string | null }>
  site_deadlines?: Array<{ id: string; title: string; due_date: string }>
  canonical_subject?: Array<{ id: string; label: string }>
  site_reports?: Array<{ ended_at: string }>
}

function makeAdminClient(fixtures: TableFixtures = {}) {
  const data: Record<string, unknown> = {
    sites: fixtures.sites ?? { name: 'Chantier OCEF' },
    subject_thread_identity: fixtures.subject_thread_identity ?? [],
    site_actions: fixtures.site_actions ?? [],
    site_reserve: fixtures.site_reserve ?? [],
    site_deadlines: fixtures.site_deadlines ?? [],
    canonical_subject: fixtures.canonical_subject ?? [],
    site_reports: fixtures.site_reports ?? [],
  }

  function makeBuilder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    const chainFns = ['select', 'eq', 'in', 'not', 'lt', 'lte', 'gte', 'order', 'limit']
    for (const fn of chainFns) b[fn] = () => b
    b.single = () => Promise.resolve({ data: data[table] ?? null, error: null })
    b.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve, reject)
    return b
  }

  return { from: (table: string) => makeBuilder(table) }
}

// ── Imports après mocks (pour que vi.mock soit actif) ─────────────────────────

import { buildSiteIntelligenceContext } from './build-site-intelligence-context'
import { deriveSiteAttentionItems } from '@/lib/knowledge/site-attention-items'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { listConfirmedLinksForSite } from '@/lib/db/subject-thread-links'
import { getSiteIntervenantsView } from '@/lib/knowledge/site-intervenants-view'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { createAdminClient } from '@/lib/supabase/admin'

const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(deriveSiteAttentionItems).mockResolvedValue([])
  vi.mocked(getNavigableSubjectsForSite).mockResolvedValue([])
  vi.mocked(listConfirmedLinksForSite).mockResolvedValue([])
  vi.mocked(getSiteIntervenantsView).mockResolvedValue(makeIntervenantsView())
  vi.mocked(listBlocagesBySite).mockResolvedValue([])
  vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as unknown as ReturnType<typeof createAdminClient>)
})

// ── 1. Dimensions absentes quand option désactivée ────────────────────────────

describe('Options désactivées → dimension absente', () => {
  it('subjects absent si subjects=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.subjects).toBeUndefined()
    expect(vi.mocked(getNavigableSubjectsForSite)).not.toHaveBeenCalled()
  })

  it('attention absente si attention=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.attention).toBeUndefined()
    expect(vi.mocked(deriveSiteAttentionItems)).not.toHaveBeenCalled()
  })

  it('relations absentes si relations=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.relations).toBeUndefined()
    expect(vi.mocked(listConfirmedLinksForSite)).not.toHaveBeenCalled()
  })

  it('actors absents si actors=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.actors).toBeUndefined()
    expect(vi.mocked(getSiteIntervenantsView)).not.toHaveBeenCalled()
  })

  it('blockages absents si blockages=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.blockages).toBeUndefined()
    // listBlocagesBySite peut être appelé pour activeObjects si activeObjects=true,
    // mais ici les deux sont false.
    expect(vi.mocked(listBlocagesBySite)).not.toHaveBeenCalled()
  })

  it('timeline absente si timeline=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.timeline).toBeUndefined()
  })

  it('activeObjects absent si activeObjects=false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})
    expect(ctx.activeObjects).toBeUndefined()
  })
})

// ── 2-5. Limites max* ─────────────────────────────────────────────────────────

describe('Limites max*', () => {
  it('maxSubjects respecté', async () => {
    const subjects = Array.from({ length: 10 }, (_, i) =>
      makeSubject({ canonicalSubjectId: `cs-${i}`, title: `Sujet ${i}` }),
    )
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue(subjects)

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { subjects: true, maxSubjects: 3 })

    expect(ctx.subjects?.items).toHaveLength(3)
    expect(ctx.subjects?.total).toBe(10)
    expect(ctx.subjects?.truncated).toBe(true)
  })

  it('pas de truncation si total <= max', async () => {
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue([makeSubject()])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { subjects: true, maxSubjects: 20 })

    expect(ctx.subjects?.truncated).toBe(false)
    expect(ctx.subjects?.total).toBe(1)
  })

  it('maxAttentionItems respecté', async () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeAttentionItem({ title: `Item ${i}` }),
    )
    vi.mocked(deriveSiteAttentionItems).mockResolvedValue(items)

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { attention: true, maxAttentionItems: 3 })

    expect(ctx.attention?.items).toHaveLength(3)
    expect(ctx.attention?.total).toBe(8)
    expect(ctx.attention?.truncated).toBe(true)
  })

  it('maxRelations respecté', async () => {
    const links = Array.from({ length: 10 }, (_, i) =>
      makeLink({ id: `link-${i}`, fromThreadId: `from-${i}`, toThreadId: `to-${i}` }),
    )
    vi.mocked(listConfirmedLinksForSite).mockResolvedValue(links)
    // Fournir mappings thread→canonical pour chaque link
    const threadIdentity = [
      ...links.map((l) => ({ subject_thread_id: l.fromThreadId, canonical_subject_id: `cs-from-${l.id}` })),
      ...links.map((l) => ({ subject_thread_id: l.toThreadId, canonical_subject_id: `cs-to-${l.id}` })),
    ]
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ subject_thread_identity: threadIdentity }) as unknown as ReturnType<typeof createAdminClient>,
    )

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { relations: true, maxRelations: 4 })

    expect(ctx.relations?.items).toHaveLength(4)
    expect(ctx.relations?.total).toBe(10)
    expect(ctx.relations?.truncated).toBe(true)
  })

  it('maxActors respecté', async () => {
    const people = Array.from({ length: 8 }, (_, i) =>
      makePerson({ intervenantId: `iv-${i}`, name: `Personne ${i}`, companyId: 'company-1', companyName: 'PAVE' }),
    )
    vi.mocked(getSiteIntervenantsView).mockResolvedValue({
      siteId: SITE_ID,
      confirmedCount: 8,
      toIdentifyCount: 0,
      companies: ['PAVE'],
      groups: [{ companyId: 'company-1', companyName: 'PAVE', roles: ['Entreprise'], people }],
      toIdentify: [],
    })

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { actors: true, maxActors: 3 })

    expect(ctx.actors?.items).toHaveLength(3)
    expect(ctx.actors?.total).toBe(8)
    expect(ctx.actors?.truncated).toBe(true)
  })
})

// ── 6-9. Préservation des identifiants ───────────────────────────────────────

describe('Préservation des IDs', () => {
  it('canonicalSubjectId préservé sur subjects', async () => {
    const subject = makeSubject({ canonicalSubjectId: 'cs-EXACT-001' })
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue([subject])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { subjects: true })

    expect(ctx.subjects?.items[0].canonicalSubjectId).toBe('cs-EXACT-001')
  })

  it('linkId et fromCanonicalSubjectId préservés sur relations', async () => {
    const link = makeLink({ id: 'link-EXACT-001', fromThreadId: 'thread-A', toThreadId: 'thread-B' })
    vi.mocked(listConfirmedLinksForSite).mockResolvedValue([link])
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({
        subject_thread_identity: [
          { subject_thread_id: 'thread-A', canonical_subject_id: 'cs-FROM-001' },
          { subject_thread_id: 'thread-B', canonical_subject_id: 'cs-TO-001' },
        ],
        canonical_subject: [
          { id: 'cs-FROM-001', label: 'Réserves béton' },
          { id: 'cs-TO-001', label: 'Réception G3' },
        ],
      }) as unknown as ReturnType<typeof createAdminClient>,
    )

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { relations: true })

    expect(ctx.relations?.items[0].linkId).toBe('link-EXACT-001')
    expect(ctx.relations?.items[0].fromCanonicalSubjectId).toBe('cs-FROM-001')
    expect(ctx.relations?.items[0].toCanonicalSubjectId).toBe('cs-TO-001')
    expect(ctx.relations?.items[0].fromLabel).toBe('Réserves béton')
    expect(ctx.relations?.items[0].toLabel).toBe('Réception G3')
  })

  it('intervenantId et contactId préservés sur actors', async () => {
    const person = makePerson({ intervenantId: 'iv-EXACT-001', contactId: 'contact-EXACT-001' })
    vi.mocked(getSiteIntervenantsView).mockResolvedValue(makeIntervenantsView([person]))

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { actors: true })

    expect(ctx.actors?.items[0].intervenantId).toBe('iv-EXACT-001')
    expect(ctx.actors?.items[0].contactId).toBe('contact-EXACT-001')
  })

  it('actionId, reserveId, deadlineId, blocageId préservés sur activeObjects', async () => {
    vi.mocked(listBlocagesBySite).mockResolvedValue([makeBlocage({ id: 'bloc-EXACT-001', dateEnd: null })])
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({
        site_actions: [{ id: 'act-EXACT-001', title: 'Action en retard', due_date: '2026-07-01', subject_thread_id: null, assigned_to: null }],
        site_reserve: [{ id: 'res-EXACT-001', label: 'Réserve béton', issued_on: '2026-06-01' }],
        site_deadlines: [{ id: 'dead-EXACT-001', title: 'Jalon GPA', due_date: '2026-06-01' }],
      }) as unknown as ReturnType<typeof createAdminClient>,
    )

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { activeObjects: true })

    expect(ctx.activeObjects?.actionsEnRetard[0].actionId).toBe('act-EXACT-001')
    expect(ctx.activeObjects?.reservesOuvertes[0].reserveId).toBe('res-EXACT-001')
    expect(ctx.activeObjects?.echeancesDepassees[0].deadlineId).toBe('dead-EXACT-001')
    expect(ctx.activeObjects?.blocagesActifs[0].blocageId).toBe('bloc-EXACT-001')
  })
})

// ── 10. Rejected exclu ────────────────────────────────────────────────────────

describe('Rejected exclu', () => {
  it('listConfirmedLinksForSite ne retourne que des liens confirmed (contrat service)', async () => {
    // listConfirmedLinksForSite filtre déjà status='confirmed' en DB.
    // Le test vérifie que buildSiteIntelligenceContext n'ajoute pas de filtre
    // supplémentaire qui inclurait rejected par erreur.
    const confirmedLink = makeLink({ status: 'confirmed' })
    vi.mocked(listConfirmedLinksForSite).mockResolvedValue([confirmedLink])
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({
        subject_thread_identity: [
          { subject_thread_id: 'thread-A', canonical_subject_id: 'cs-A' },
          { subject_thread_id: 'thread-B', canonical_subject_id: 'cs-B' },
        ],
      }) as unknown as ReturnType<typeof createAdminClient>,
    )

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { relations: true })

    expect(ctx.relations?.items).toHaveLength(1)
    expect(ctx.relations?.items[0].linkId).toBe('link-001')
  })
})

// ── 11. Chantier vide ─────────────────────────────────────────────────────────

describe('Chantier vide', () => {
  it('toutes les dimensions activées, données vides → pas de crash', async () => {
    vi.mocked(deriveSiteAttentionItems).mockResolvedValue([])
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue([])
    vi.mocked(listConfirmedLinksForSite).mockResolvedValue([])
    vi.mocked(getSiteIntervenantsView).mockResolvedValue(makeIntervenantsView([]))
    vi.mocked(listBlocagesBySite).mockResolvedValue([])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, {
      subjects: true, attention: true, activeObjects: true,
      relations: true, actors: true, timeline: true, blockages: true,
    })

    expect(ctx.subjects?.items).toHaveLength(0)
    expect(ctx.subjects?.total).toBe(0)
    expect(ctx.attention?.items).toHaveLength(0)
    expect(ctx.attention?.total).toBe(0)
    expect(ctx.relations?.items).toHaveLength(0)
    expect(ctx.relations?.total).toBe(0)
    expect(ctx.actors?.items).toHaveLength(0)
    expect(ctx.actors?.total).toBe(0)
    expect(ctx.activeObjects?.counts.actionsEnRetard).toBe(0)
    expect(ctx.blockages?.activeCount).toBe(0)
    expect(ctx.timeline?.lastVisitAt).toBeNull()
  })
})

// ── 12-14. meta ───────────────────────────────────────────────────────────────

describe('meta', () => {
  it('retrievalNeeded toujours false', async () => {
    const ctx = await buildSiteIntelligenceContext(SITE_ID, {
      subjects: true, attention: true, relations: true,
    })
    expect(ctx.meta.retrievalNeeded).toBe(false)
  })

  it('dimensionsLoaded reflète les options activées', async () => {
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue([makeSubject()])
    vi.mocked(deriveSiteAttentionItems).mockResolvedValue([makeAttentionItem()])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, {
      subjects: true, attention: true,
    })

    expect(ctx.meta.dimensionsLoaded).toContain('subjects')
    expect(ctx.meta.dimensionsLoaded).toContain('attention')
    expect(ctx.meta.dimensionsLoaded).not.toContain('relations')
    expect(ctx.meta.dimensionsLoaded).not.toContain('actors')
  })

  it('dataGap signalé si actors hors org (null)', async () => {
    vi.mocked(getSiteIntervenantsView).mockResolvedValue(null)

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { actors: true })

    expect(ctx.actors?.items).toHaveLength(0)
    expect(ctx.meta.dataGaps.some((g) => g.includes('intervenants'))).toBe(true)
  })

  it('siteId et siteName présents', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ sites: { name: 'OCEF — Hôpital' } }) as unknown as ReturnType<typeof createAdminClient>,
    )

    const ctx = await buildSiteIntelligenceContext(SITE_ID, {})

    expect(ctx.siteId).toBe(SITE_ID)
    expect(ctx.siteName).toBe('OCEF — Hôpital')
  })
})

// ── Compteurs attention ───────────────────────────────────────────────────────

describe('Compteurs attention', () => {
  it('criticalCount et highCount corrects', async () => {
    const items: SiteAttentionItem[] = [
      makeAttentionItem({ urgency: 'critical' }),
      makeAttentionItem({ urgency: 'critical', title: 'Blocage 2' }),
      makeAttentionItem({ urgency: 'high', title: 'Action en retard' }),
      makeAttentionItem({ urgency: 'medium', title: 'Stagnant' }),
    ]
    vi.mocked(deriveSiteAttentionItems).mockResolvedValue(items)

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { attention: true })

    expect(ctx.attention?.criticalCount).toBe(2)
    expect(ctx.attention?.highCount).toBe(1)
    expect(ctx.attention?.total).toBe(4)
  })
})

// ── stagnantCount ─────────────────────────────────────────────────────────────

describe('stagnantCount', () => {
  it('stagnantCount compte les sujets stagnants', async () => {
    const subjects = [
      makeSubject({ canonicalSubjectId: 'cs-1', isStagnant: true }),
      makeSubject({ canonicalSubjectId: 'cs-2', isStagnant: false }),
      makeSubject({ canonicalSubjectId: 'cs-3', isStagnant: true }),
    ]
    vi.mocked(getNavigableSubjectsForSite).mockResolvedValue(subjects)

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { subjects: true })

    expect(ctx.subjects?.stagnantCount).toBe(2)
  })
})

// ── Blocages actifs filtrés ───────────────────────────────────────────────────

describe('Blocages actifs', () => {
  it('seuls les blocages dateEnd=null sont dans activeObjects.blocagesActifs', async () => {
    const active = makeBlocage({ id: 'active', dateEnd: null })
    const ended = makeBlocage({ id: 'ended', dateEnd: '2026-07-01' })
    vi.mocked(listBlocagesBySite).mockResolvedValue([active, ended])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { activeObjects: true })

    expect(ctx.activeObjects?.blocagesActifs).toHaveLength(1)
    expect(ctx.activeObjects?.blocagesActifs[0].blocageId).toBe('active')
  })

  it('blockages dimension inclut tous les blocages (actifs + terminés)', async () => {
    const active = makeBlocage({ id: 'active', dateEnd: null })
    const ended = makeBlocage({ id: 'ended', dateEnd: '2026-07-01' })
    vi.mocked(listBlocagesBySite).mockResolvedValue([active, ended])

    const ctx = await buildSiteIntelligenceContext(SITE_ID, { blockages: true })

    expect(ctx.blockages?.totalCount).toBe(2)
    expect(ctx.blockages?.activeCount).toBe(1)
    expect(ctx.blockages?.all).toHaveLength(2)
  })
})
