import { describe, it, expect, vi, beforeEach } from 'vitest'
import { projectHistoricalParticipants } from '@/lib/documents/historical-participant-eligibility'

// Lot F3-2 — projection des personnes éligibles en participants + persistance
// idempotente non destructive. Partie PURE (projection) testée directement ;
// idempotence + préservation manuelle testées sur mergeReportAnalysis (mock DB).

describe('F3-2 — projection pure : dédup + priorité + éligibilité', () => {
  it('3. même personne plusieurs fois → 1 participant', () => {
    const r = projectHistoricalParticipants([
      { label: 'Mme ROUSSEL', presenceVerdict: 'présent' },
      { label: 'Mme ROUSSEL', presenceVerdict: 'présent' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.presence).toBe('P')
  })
  it('4. conflit P + diffusion (même personne) → P gagne', () => {
    const r = projectHistoricalParticipants([
      { label: 'X', presenceVerdict: 'diffusion uniquement' },
      { label: 'X', presenceVerdict: 'présent' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.presence).toBe('P')
  })
  it('5. AE + diffusion → statut explicite (AE) gagne', () => {
    const r = projectHistoricalParticipants([
      { label: 'X', presenceVerdict: 'diffusion uniquement' },
      { label: 'X', presenceVerdict: 'absent excusé' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.presence).toBe('AE'); expect(r[0]!.diffusion).toBe(false)
  })
  it('6. unknown seul → aucun participant', () => {
    expect(projectHistoricalParticipants([{ label: 'X', presenceVerdict: 'inconnu' }])).toEqual([])
  })
  it('7. personne SANS entreprise mais présence prouvée → participant (sans contactId)', () => {
    const r = projectHistoricalParticipants([{ label: 'M. SANSBOITE', presenceVerdict: 'présent' }])
    expect(r).toHaveLength(1)
    expect(r[0]!.presence).toBe('P'); expect(r[0]!.contactId).toBeUndefined()
  })
  it('8. contactId résolu → réutilisé sur le participant', () => {
    const r = projectHistoricalParticipants([{ label: 'X', presenceVerdict: 'présent', contactId: 'c-123' }])
    expect(r[0]!.contactId).toBe('c-123')
  })
  it('9. absence de contactId → aucune création (participant sans contactId, pas d’identité douteuse)', () => {
    const r = projectHistoricalParticipants([{ label: 'X', presenceVerdict: 'diffusion uniquement' }])
    expect(r[0]!.contactId).toBeUndefined()
    expect(r[0]!.diffusion).toBe(true)
  })
  it('dédup par contactId même si les noms diffèrent légèrement → 1 participant', () => {
    const r = projectHistoricalParticipants([
      { label: 'M. ROUSSEL', presenceVerdict: 'présent', contactId: 'c-1' },
      { label: 'Roussel', presenceVerdict: 'diffusion uniquement', contactId: 'c-1' },
    ])
    expect(r).toHaveLength(1); expect(r[0]!.presence).toBe('P')
  })
})

describe('F3-2 — témoins corpus (projection)', () => {
  it('10. CAPSE : 4 interlocuteurs (inconnu) → 0 participant', () => {
    const capse = ['David BOUVIER', 'Charlie BELLANGER', 'Maeva LOMBARDI', 'Catherine DELORME']
      .map((label) => ({ label, description: 'Interlocuteur — CAPSE NC', presenceVerdict: 'inconnu' }))
    expect(projectHistoricalParticipants(capse)).toEqual([])
  })
  it('11. OCEF émargement : 10 présents → 10 participants P', () => {
    const ocef = Array.from({ length: 10 }, (_, i) => ({ label: `Personne ${i}`, presenceVerdict: 'présent' }))
    const r = projectHistoricalParticipants(ocef)
    expect(r).toHaveLength(10)
    expect(r.every((p) => p.presence === 'P')).toBe(true)
  })
  it('12. BELLA : 3 diffusions + 1 inconnu → 3 participants diffusion', () => {
    const r = projectHistoricalParticipants([
      { label: 'A', presenceVerdict: 'diffusion uniquement' },
      { label: 'B', presenceVerdict: 'diffusion uniquement' },
      { label: 'C', presenceVerdict: 'diffusion uniquement' },
      { label: 'Glen DEMARQUET', description: 'Assistant RUS', presenceVerdict: 'inconnu' },
    ])
    expect(r).toHaveLength(3)
    expect(r.every((p) => p.diffusion === true && p.presence === undefined)).toBe(true)
  })
  it('13. PETRO / aucune personne → aucun participant', () => {
    expect(projectHistoricalParticipants([])).toEqual([])
  })
})

// ── Idempotence + préservation manuelle (mergeReportAnalysis, mock DB) ─────────
const mocks = vi.hoisted(() => ({ existing: [] as unknown[], captured: undefined as unknown }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { participants: mocks.existing, risks: [] } }) }) }),
      update: (payload: unknown) => { mocks.captured = payload; return { eq: async () => ({ error: null }) } },
    }),
  }),
}))
const { mergeReportAnalysis } = await import('@/lib/db/site-reports')

describe('F3-2 — persistance idempotente et non destructive (mergeReportAnalysis)', () => {
  beforeEach(() => { mocks.existing = []; mocks.captured = undefined })

  it('1. re-run = 0 ajout (participants déjà présents par nom)', async () => {
    mocks.existing = [{ name: 'Mme ROUSSEL', kind: 'person', presence: 'P' }]
    const r = await mergeReportAnalysis('r1', { participants: [{ name: 'Mme ROUSSEL', role: null, kind: 'person', presence: 'P', invite: false, diffusion: false }], risks: [] })
    expect(r.addedParticipants).toBe(0)
    expect(mocks.captured).toBeUndefined() // aucun update quand rien de nouveau
  })

  it('2. participant saisi manuellement PRÉSERVÉ, jamais écrasé par la projection', async () => {
    // L'humain a mis Mme ROUSSEL "absente excusée" ; la projection la voit "présente".
    mocks.existing = [{ name: 'Mme ROUSSEL', kind: 'person', presence: 'AE', addedAfterMeeting: true }]
    const r = await mergeReportAnalysis('r1', {
      participants: [
        { name: 'Mme ROUSSEL', role: null, kind: 'person', presence: 'P', invite: false, diffusion: false }, // même nom → écarté
        { name: 'M. NOUVEAU', role: null, kind: 'person', presence: 'P', invite: false, diffusion: false },   // nouveau → ajouté
      ],
      risks: [],
    })
    expect(r.addedParticipants).toBe(1)
    const payload = mocks.captured as { participants: Array<{ name: string; presence?: string }> }
    const roussel = payload.participants.find((p) => p.name === 'Mme ROUSSEL')!
    expect(roussel.presence).toBe('AE')   // vérité MANUELLE conservée
    expect(payload.participants.some((p) => p.name === 'M. NOUVEAU')).toBe(true)
  })
})
