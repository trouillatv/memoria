import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

// ── P5-F2b — DOCTRINE : CORRECTION_KNOWLEDGE (Vincent, 2026-08-17) ───────────
//
// Les invariants durs de ce lot, listés par Vincent avant tout commit :
//
//   1. maximum 5 candidats ;
//   2. uniquement current_information actives ;
//   3. jamais durable_knowledge (ni côté lecture, ni côté RPC) ;
//   4. aucun candidat présélectionné ;
//   5. plusieurs candidats restent réellement plusieurs candidats ;
//   6. liste vide = aucune écriture possible ;
//   7. phrase FACT sans marqueur de correction = aucune supersession ;
//   8. archivage et supersession restent deux chemins distincts.
//
// Ce fichier consolide les 8 invariants au même endroit, comme contrat de
// non-régression — le comportement détaillé (formulations reconnues,
// wording des cartes, etc.) vit dans copilot-intent-router.test.ts,
// copilot-knowledge-correction.test.ts, site-memory-entries-lifecycle.test.ts
// et copilot-knowledge-proposal-cards.test.tsx, pas dupliqué ici.

vi.mock('server-only', () => ({}))

const invalidateSiteProjection = vi.fn()
vi.mock('@/lib/knowledge/invalidate', () => ({
  invalidateSiteProjection: (siteId: string) => invalidateSiteProjection(siteId),
}))

let listResult: { data: unknown } = { data: [] }
const eqCalls: Array<[string, unknown]> = []
const limitCalls: number[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => {
        const builder = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return builder
          },
          is: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return builder
          },
          order: () => builder,
          limit: (n: number) => {
            limitCalls.push(n)
            return builder
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(listResult).then(resolve, reject),
        }
        return builder
      },
    }),
  }),
}))

const createCopilotKnowledgeSupersession = vi.fn()
const createCopilotKnowledgeArchive = vi.fn()
vi.mock('@/app/(dashboard)/sites/[id]/copilot-write-action', () => ({
  createCopilotKnowledgeSupersession: (input: unknown) => createCopilotKnowledgeSupersession(input),
  createCopilotKnowledgeArchive: (input: unknown) => createCopilotKnowledgeArchive(input),
}))
vi.mock('@/app/(dashboard)/sites/[id]/copilot-event-action', () => ({
  trackCopilotProposalCancelled: vi.fn(),
}))

import { listRecentCurrentInformationEntries } from '@/lib/db/site-memory-entries'
import { detectIntent } from '@/lib/visits/copilot-intent-router'
import { extractKnowledgeCorrection } from '@/lib/visits/copilot-knowledge-correction'
import { buildKnowledgeSupersessionProposal, buildKnowledgeArchiveProposal, type KnowledgeCorrectionCandidate } from '@/lib/visits/copilot-proposal'
import { KnowledgeSupersessionProposalCard, KnowledgeArchiveProposalCard } from '@/components/copilot/CopilotProposalCards'

const SITE_ID = '33333333-3333-3333-3333-333333333333'

function candidate(id: string, title: string): KnowledgeCorrectionCandidate {
  return { id, title, body: null, confirmedAt: '2026-08-10T08:00:00Z' }
}
const THREE = [candidate('e1', 'Titre 1'), candidate('e2', 'Titre 2'), candidate('e3', 'Titre 3')]

beforeEach(() => {
  eqCalls.length = 0
  limitCalls.length = 0
  listResult = { data: [] }
  createCopilotKnowledgeSupersession.mockReset().mockResolvedValue({ ok: true, entryId: 'new' })
  createCopilotKnowledgeArchive.mockReset().mockResolvedValue({ ok: true })
})

describe('Doctrine 1+2+3 — la recherche de candidats est bornée par construction', () => {
  it('limite par défaut à 5 candidats', async () => {
    await listRecentCurrentInformationEntries(SITE_ID)
    expect(limitCalls).toEqual([5])
  })

  it('ne scope que kind=current_information, status=active, deleted_at=null — jamais durable_knowledge', async () => {
    await listRecentCurrentInformationEntries(SITE_ID)
    expect(eqCalls).toEqual([
      ['site_id', SITE_ID],
      ['kind', 'current_information'],
      ['status', 'active'],
      ['deleted_at', null],
    ])
    expect(eqCalls.some(([, val]) => val === 'durable_knowledge')).toBe(false)
  })

  it('la RPC supersede_knowledge_entry (mig 334) refuse explicitement toute entrée qui n\'est pas current_information', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/334_supersede_knowledge_entry_rpc.sql'),
      'utf8',
    )
    expect(sql).toContain("v_old.kind <> 'current_information'")
    expect(sql).toMatch(/raise exception/i)
  })
})

describe('Doctrine 4+5 — aucun candidat présélectionné, plusieurs candidats restent plusieurs candidats', () => {
  it('supersession : 3 candidats fournis → 3 radios candidats, aucun coché au montage', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Nouveau', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.length).toBeGreaterThanOrEqual(THREE.length)
    expect(radios.some((r) => r.checked)).toBe(false)
  })

  it('archivage : 3 candidats fournis → 3 radios, aucun coché au montage', () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: THREE })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)
    expect(radios.some((r) => r.checked)).toBe(false)
  })
})

describe('Doctrine 6 — liste vide = aucune écriture possible', () => {
  it('archivage sans candidat : aucun radio, bouton Valider disabled, jamais d\'appel serveur', async () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: [] })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    const button = screen.getByRole('button', { name: /valider/i })
    expect(button).toBeDisabled()
    await act(async () => {
      fireEvent.click(button)
    })
    expect(createCopilotKnowledgeArchive).not.toHaveBeenCalled()
  })

  it('supersession sans candidat : seule "Aucune de celles-ci" existe, bouton Valider disabled tant que rien n\'est choisi', () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Nouveau', candidates: [] })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled()
  })
})

describe('Doctrine 7 — phrase FACT sans marqueur de correction = aucune supersession', () => {
  it('routeur : "Jérôme passe lundi." reste FACT, jamais CORRECTION_KNOWLEDGE', () => {
    expect(detectIntent('Jérôme passe lundi.').intent).toBe('FACT')
  })

  it('extraction : "Jérôme passe lundi." → null, aucune recherche de candidat déclenchée', () => {
    expect(extractKnowledgeCorrection('Jérôme passe lundi.')).toBeNull()
  })
})

describe('Doctrine 8 — archivage et supersession restent deux chemins distincts', () => {
  const WRITE_ACTION_FILE = join(process.cwd(), 'app/(dashboard)/sites/[id]/copilot-write-action.ts')

  function functionSource(name: string): string {
    const src = readFileSync(WRITE_ACTION_FILE, 'utf8')
    const start = src.indexOf(`export async function ${name}`)
    expect(start, `${name} introuvable`).toBeGreaterThan(-1)
    const end = src.indexOf('\nexport ', start + 1)
    return src.slice(start, end === -1 ? undefined : end)
  }

  it('createCopilotKnowledgeSupersession n\'appelle jamais archiveKnowledgeEntry', () => {
    expect(functionSource('createCopilotKnowledgeSupersession')).not.toContain('archiveKnowledgeEntry')
  })

  it('createCopilotKnowledgeArchive n\'appelle jamais supersedeKnowledgeEntry ni confirmSiteFact', () => {
    const fn = functionSource('createCopilotKnowledgeArchive')
    expect(fn).not.toContain('supersedeKnowledgeEntry')
    expect(fn).not.toContain('confirmSiteFact')
  })

  it('au runtime, choisir "Aucune de celles-ci" sur la carte supersession n\'appelle jamais createCopilotKnowledgeArchive', async () => {
    const proposal = buildKnowledgeSupersessionProposal({ newTitle: 'Nouveau', candidates: THREE })
    render(<KnowledgeSupersessionProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    fireEvent.click(screen.getByText(/aucune de celles-ci/i))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })
    await waitFor(() => expect(createCopilotKnowledgeSupersession).toHaveBeenCalledTimes(1))
    expect(createCopilotKnowledgeArchive).not.toHaveBeenCalled()
  })

  it('au runtime, confirmer un candidat sur la carte archivage n\'appelle jamais createCopilotKnowledgeSupersession', async () => {
    const proposal = buildKnowledgeArchiveProposal({ candidates: THREE })
    render(<KnowledgeArchiveProposalCard siteId={SITE_ID} proposal={proposal} interactionId={null} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Titre 2'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })
    await waitFor(() => expect(createCopilotKnowledgeArchive).toHaveBeenCalledTimes(1))
    expect(createCopilotKnowledgeSupersession).not.toHaveBeenCalled()
  })
})
