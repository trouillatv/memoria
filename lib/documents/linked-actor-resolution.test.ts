import { describe, it, expect } from 'vitest'
import { resolveLinkedActors } from './linked-actor-resolution'
import { prefixChunkResult } from './historical-visit-extractor'
import type { LlmExtractionResult } from './historical-visit-extractor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(proposals: LlmExtractionResult['proposals']): LlmExtractionResult {
  return { proposals, evidence: [] }
}

function action(key: string, actorKey?: string): LlmExtractionResult['proposals'][number] {
  return {
    temporaryKey: key,
    family: 'action',
    label: 'Reprendre réseau',
    evidenceKeys: [],
    sourcePayload: {
      relevanceScore: 'strong',
      ...(actorKey ? { linkedActorTemporaryKey: actorKey } : {}),
    },
  }
}

function company(key: string): LlmExtractionResult['proposals'][number] {
  return {
    temporaryKey: key,
    family: 'company',
    label: 'DUMEZ',
    evidenceKeys: [],
    sourcePayload: { companyRole: 'entreprise titulaire', relevanceScore: 'strong' },
  }
}

function person(key: string): LlmExtractionResult['proposals'][number] {
  return {
    temporaryKey: key,
    family: 'person',
    label: 'Jean Dupont',
    evidenceKeys: [],
    sourcePayload: { statusAtDocumentDate: 'présent', relevanceScore: 'medium' },
  }
}

// ── Tests resolveLinkedActors ─────────────────────────────────────────────────

describe('resolveLinkedActors', () => {
  it('1 — action → company du même chunk', () => {
    const proposals = [{ id: 'id-act', source_payload: { linkedActorTemporaryKey: 'comp-A' } }]
    const mat = new Map([['id-act', 'site-action-1']])
    const companies = new Map([['comp-A', 'company-uuid-1']])
    const contacts = new Map<string, string>()

    const result = resolveLinkedActors(proposals, mat, companies, contacts)

    expect(result).toEqual([{ siteActionId: 'site-action-1', kind: 'company', actorId: 'company-uuid-1' }])
  })

  it('2 — action → person du même chunk', () => {
    const proposals = [{ id: 'id-act', source_payload: { linkedActorTemporaryKey: 'pers-B' } }]
    const mat = new Map([['id-act', 'site-action-2']])
    const companies = new Map<string, string>()
    const contacts = new Map([['pers-B', 'contact-uuid-1']])

    const result = resolveLinkedActors(proposals, mat, companies, contacts)

    expect(result).toEqual([{ siteActionId: 'site-action-2', kind: 'contact', actorId: 'contact-uuid-1' }])
  })

  it('4 — linkedActorTemporaryKey absent → aucun responsable', () => {
    const proposals = [{ id: 'id-act', source_payload: { relevanceScore: 'strong' } }]
    const mat = new Map([['id-act', 'site-action-3']])
    const result = resolveLinkedActors(proposals, mat, new Map(), new Map())
    expect(result).toEqual([])
  })

  it('5 — clé pointant vers proposition ni person ni company → aucune attribution', () => {
    const proposals = [{ id: 'id-act', source_payload: { linkedActorTemporaryKey: 'obs-ghost' } }]
    const mat = new Map([['id-act', 'site-action-4']])
    // 'obs-ghost' n'est ni dans companies ni dans contacts
    const result = resolveLinkedActors(proposals, mat, new Map(), new Map())
    expect(result).toEqual([])
  })

  it('6 — action sans responsable explicite → aucun lien inventé', () => {
    const proposals = [{ id: 'id-act', source_payload: null }]
    const mat = new Map([['id-act', 'site-action-5']])
    const result = resolveLinkedActors(proposals, mat, new Map([['comp-X', 'co-1']]), new Map())
    expect(result).toEqual([])
  })

  it('company prioritaire sur contact si même clé', () => {
    // cas théoriquement impossible mais garanti : company gagne
    const proposals = [{ id: 'id-act', source_payload: { linkedActorTemporaryKey: 'actor-1' } }]
    const mat = new Map([['id-act', 'site-action-6']])
    const companies = new Map([['actor-1', 'co-uuid']])
    const contacts = new Map([['actor-1', 'ct-uuid']])
    const [res] = resolveLinkedActors(proposals, mat, companies, contacts)
    expect(res.kind).toBe('company')
  })

  it('action non matérialisée → ignorée silencieusement', () => {
    const proposals = [{ id: 'id-act', source_payload: { linkedActorTemporaryKey: 'comp-A' } }]
    const mat = new Map<string, string>() // pas de materialisation
    const result = resolveLinkedActors(proposals, mat, new Map([['comp-A', 'co-1']]), new Map())
    expect(result).toEqual([])
  })
})

// ── Tests prefixChunkResult ───────────────────────────────────────────────────

describe('prefixChunkResult', () => {
  it('3a — chunk 0 : aucun préfixe appliqué', () => {
    const r = makeResult([action('act-A', 'comp-X'), company('comp-X')])
    const out = prefixChunkResult(r, 0)
    expect(out.proposals[0].temporaryKey).toBe('act-A')
    expect((out.proposals[0].sourcePayload as Record<string, string>).linkedActorTemporaryKey).toBe('comp-X')
    expect(out.proposals[1].temporaryKey).toBe('comp-X')
  })

  it('3b — chunk 1 : temporaryKey, evidenceKeys et linkedActorTemporaryKey préfixés', () => {
    const r = makeResult([action('act-A', 'comp-X'), company('comp-X')])
    const out = prefixChunkResult(r, 1)
    expect(out.proposals[0].temporaryKey).toBe('c1-act-A')
    expect((out.proposals[0].sourcePayload as Record<string, string>).linkedActorTemporaryKey).toBe('c1-comp-X')
    expect(out.proposals[1].temporaryKey).toBe('c1-comp-X')
  })

  it('3c — chunks différents : même base temporaryKey → clés distinctes après préfixage', () => {
    const r0 = makeResult([action('act-A', 'comp-X'), company('comp-X')])
    const r1 = makeResult([action('act-A', 'comp-X'), company('comp-X')])
    const out0 = prefixChunkResult(r0, 0)
    const out1 = prefixChunkResult(r1, 1)

    const keys0 = out0.proposals.map((p) => p.temporaryKey)
    const keys1 = out1.proposals.map((p) => p.temporaryKey)

    for (const k0 of keys0) expect(keys1).not.toContain(k0)
  })

  it('9 — document multi-chunk : aucune collision de temporaryKey entre chunks 0, 1, 2', () => {
    const base = makeResult([action('act-same'), company('comp-same')])
    const all = [0, 1, 2].map((i) => prefixChunkResult(base, i))
    const allKeys = all.flatMap((r) => r.proposals.map((p) => p.temporaryKey))
    const unique = new Set(allKeys)
    expect(unique.size).toBe(allKeys.length)
  })

  it('action sans linkedActorTemporaryKey → sourcePayload inchangé', () => {
    const r = makeResult([action('act-B')])
    const out = prefixChunkResult(r, 1)
    expect((out.proposals[0].sourcePayload as Record<string, unknown>).linkedActorTemporaryKey).toBeUndefined()
  })

  it('evidence temporaryKey préfixée au chunk 2', () => {
    const r: LlmExtractionResult = {
      proposals: [],
      evidence: [{ temporaryKey: 'ev-snap-p3', evidenceType: 'page_snapshot', sourcePage: 3 }],
    }
    const out = prefixChunkResult(r, 2)
    expect(out.evidence[0].temporaryKey).toBe('c2-ev-snap-p3')
  })
})
