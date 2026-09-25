// P0-3.5A — population réactive des Engagements dans MissionEditor.
// Avant ce lot, `engagements` était un prop plat unique (Porte A du contrat
// de la route uniquement), figé au chargement de la page : changer de site
// (SiteSelector, y compris "otherSites" cross-contrat) ne recalculait rien.
// Ces tests couvrent le comportement CÔTÉ UI : population = {Porte A actifs
// du contrat du site sélectionné} ∪ {Porte B actifs du site lui-même},
// dédupliquée par id, avec préservation des Engagements déjà liés hors
// population courante (jamais de nouveau rattachement hors population).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MissionEditor } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/mission-editor'
import type { DbSite, DbEngagement, DbMission } from '@/types/db'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/app/(dashboard)/contracts/[id]/missions-actions', () => ({
  createMissionAction: (...args: unknown[]) => mockCreate(...args),
  updateMissionAction: (...args: unknown[]) => mockUpdate(...args),
}))

function makeSite(overrides: Partial<DbSite> = {}): DbSite {
  return {
    id: 'site-a',
    client_id: 'client-1',
    contract_id: 'contract-x',
    name: 'Site A',
    address: null,
    notes: null,
    phase: 'actif',
    access_code: null,
    alarm_code: null,
    contact_name: null,
    contact_phone: null,
    access_hours: null,
    access_instructions: null,
    created_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    organization_id: 'org-1',
    ...overrides,
  } as DbSite
}

function makeEngagement(overrides: Partial<DbEngagement> = {}): DbEngagement {
  return {
    id: 'eng-1',
    tender_id: null,
    contract_id: null,
    site_id: null,
    source_type: 'manual',
    source_excerpt: 'excerpt',
    source_ref: null,
    tender_document_id: null,
    source_document_id: null,
    page_number: null,
    category: 'other',
    kind: null,
    short_label: 'Engagement',
    measurable: false,
    ai_confidence: null,
    status: 'active',
    proof_requirement: 'none',
    destination: 'contract_engagement',
    organization_id: 'org-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...overrides,
  }
}

function makeMission(overrides: Partial<DbMission> = {}): DbMission {
  return {
    id: 'mission-1',
    site_id: 'site-a',
    name: 'Mission existante',
    description: null,
    cadence: 'weekly',
    default_team: [],
    engagement_ids: [],
    default_checklist: [],
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    created_by: null,
    assigned_team_id: null,
    ...overrides,
  } as DbMission
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MissionEditor — population du site du contrat courant', () => {
  it('affiche Porte A (contrat du site) ∪ Porte B (site lui-même)', () => {
    const siteA = makeSite()
    const engA = makeEngagement({ id: 'eng-a', contract_id: 'contract-x', short_label: 'Porte A — contrat X' })
    const engB = makeEngagement({ id: 'eng-b', site_id: 'site-a', short_label: 'Porte B — site A' })

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{ 'contract-x': [engA] }}
        siteEngagements={{ 'site-a': [engB] }}
      />,
    )

    expect(screen.getByText('Porte A — contrat X')).toBeInTheDocument()
    expect(screen.getByText('Porte B — site A')).toBeInTheDocument()
  })
})

describe('MissionEditor — Porte B curated exclue de la population', () => {
  it('un Engagement Porte B curated (non passé dans les maps actifs) ne figure jamais dans la liste', () => {
    const siteA = makeSite()
    // La page appelante ne préchargerait de toute façon jamais un curated ici
    // (listActiveEngagementsBySites filtre déjà) — ce test verrouille le
    // comportement du composant lui-même : il n'invente rien au-delà des
    // maps reçues.
    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{}}
        siteEngagements={{ 'site-a': [] }}
      />,
    )

    expect(screen.getByText('Aucune promesse active sur ce chantier.')).toBeInTheDocument()
  })
})

describe('MissionEditor — changement de site cross-contrat (otherSites)', () => {
  it('recalcule la population sans fuite du contrat de la route', () => {
    const siteA = makeSite({ id: 'site-a', contract_id: 'contract-x', name: 'Site A' })
    const otherSiteC = { id: 'site-c', name: 'Site C', contract_name: 'Contrat Y', contract_id: 'contract-y' }
    const engX = makeEngagement({ id: 'eng-x', contract_id: 'contract-x', short_label: 'Engagement X' })
    const engY = makeEngagement({ id: 'eng-y', contract_id: 'contract-y', short_label: 'Engagement Y' })

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        otherSites={[otherSiteC]}
        contractEngagements={{ 'contract-x': [engX], 'contract-y': [engY] }}
        siteEngagements={{}}
      />,
    )

    // Site A (route) sélectionné par défaut : seul Engagement X visible.
    expect(screen.getByText('Engagement X')).toBeInTheDocument()
    expect(screen.queryByText('Engagement Y')).not.toBeInTheDocument()

    // Bascule vers Site C (autre contrat) via le SiteSelector réel.
    fireEvent.click(screen.getByRole('button', { name: 'Site A' }))
    const siteCOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('Site C'))
    expect(siteCOption).toBeTruthy()
    fireEvent.click(siteCOption!)

    // Plus aucune fuite de l'Engagement du contrat de la route.
    expect(screen.getByText('Engagement Y')).toBeInTheDocument()
    expect(screen.queryByText('Engagement X')).not.toBeInTheDocument()
  })
})

describe('MissionEditor — redirection après création (FIX_REQUIRED P0-3.5A #3)', () => {
  it('redirige vers le contrat de la route quand le site sélectionné est celui de la route', async () => {
    mockCreate.mockResolvedValue({ ok: true, missionId: 'new-mission' })
    const siteA = makeSite({ id: 'site-a', contract_id: 'contract-x', name: 'Site A' })

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{}}
        siteEngagements={{}}
      />,
    )

    const [nameInput] = screen.getAllByRole('textbox')
    fireEvent.change(nameInput, { target: { value: 'Mission même contrat' } })
    fireEvent.click(screen.getByText('Créer la mission'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockPush).toHaveBeenCalledWith('/contracts/contract-x/missions')
  })

  it('redirige vers le contrat RÉEL du site sélectionné, pas celui de la route', async () => {
    mockCreate.mockResolvedValue({ ok: true, missionId: 'new-mission' })
    const siteA = makeSite({ id: 'site-a', contract_id: 'contract-x', name: 'Site A' })
    const otherSiteC = { id: 'site-c', name: 'Site C', contract_name: 'Contrat Y', contract_id: 'contract-y' }

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        otherSites={[otherSiteC]}
        contractEngagements={{}}
        siteEngagements={{}}
      />,
    )

    // Bascule vers Site C (contrat Y) via le SiteSelector réel.
    fireEvent.click(screen.getByRole('button', { name: 'Site A' }))
    const siteCOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('Site C'))
    fireEvent.click(siteCOption!)

    const [nameInput] = screen.getAllByRole('textbox')
    fireEvent.change(nameInput, { target: { value: 'Mission cross-contrat' } })
    fireEvent.click(screen.getByText('Créer la mission'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    const fd = mockCreate.mock.calls[0][0] as FormData
    expect(fd.get('site_id')).toBe('site-c')
    expect(mockPush).toHaveBeenCalledWith('/contracts/contract-y/missions')
  })

  it('redirige vers /missions si le site sélectionné n’a pas de contrat', async () => {
    mockCreate.mockResolvedValue({ ok: true, missionId: 'new-mission' })
    const siteA = makeSite({ id: 'site-a', contract_id: 'contract-x', name: 'Site A' })
    const otherSiteNoContract = { id: 'site-d', name: 'Site D', contract_name: null, contract_id: null }

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        otherSites={[otherSiteNoContract]}
        contractEngagements={{}}
        siteEngagements={{}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Site A' }))
    const siteDOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('Site D'))
    fireEvent.click(siteDOption!)

    const [nameInput] = screen.getAllByRole('textbox')
    fireEvent.change(nameInput, { target: { value: 'Mission sans contrat' } })
    fireEvent.click(screen.getByText('Créer la mission'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockPush).toHaveBeenCalledWith('/missions')
  })
})

describe('MissionEditor — dédup par engagement.id', () => {
  it('un même id présent dans contractEngagements et siteEngagements n’apparaît qu’une fois', () => {
    const siteA = makeSite()
    const shared = makeEngagement({ id: 'eng-shared', short_label: 'Promesse partagée' })

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{ 'contract-x': [shared] }}
        siteEngagements={{ 'site-a': [shared] }}
      />,
    )

    expect(screen.getAllByText('Promesse partagée')).toHaveLength(1)
  })
})

describe('MissionEditor — création', () => {
  it('appelle createMissionAction avec le site sélectionné et les champs saisis', async () => {
    mockCreate.mockResolvedValue({ ok: true, missionId: 'new-mission' })
    const siteA = makeSite()

    render(
      <MissionEditor
        mode="create"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{}}
        siteEngagements={{}}
      />,
    )

    const [nameInput] = screen.getAllByRole('textbox')
    fireEvent.change(nameInput, { target: { value: 'Ma nouvelle mission' } })
    fireEvent.click(screen.getByText('Créer la mission'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    const fd = mockCreate.mock.calls[0][0] as FormData
    expect(fd.get('site_id')).toBe('site-a')
    expect(fd.get('name')).toBe('Ma nouvelle mission')
    expect(fd.get('cadence')).toBe('daily')
    expect(JSON.parse(fd.get('engagement_ids') as string)).toEqual([])
  })
})

describe('MissionEditor — édition, préservation hors population', () => {
  it('affiche un Engagement déjà lié mais sorti de la population, et permet de le détacher', async () => {
    mockUpdate.mockResolvedValue({ ok: true })
    const siteA = makeSite()
    const preserved = makeEngagement({ id: 'eng-old', short_label: 'Ancienne promesse (hors population)' })
    const mission = makeMission({ site_id: 'site-a', engagement_ids: ['eng-old'] })

    render(
      <MissionEditor
        mode="edit"
        contractId="contract-x"
        sites={[siteA]}
        contractEngagements={{}}
        siteEngagements={{}}
        preservedEngagements={[preserved]}
        initialMission={mission}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
    expect(screen.getByText('Ancienne promesse (hors population)')).toBeInTheDocument()

    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('Sauver'))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const fd = mockUpdate.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('mission-1')
    expect(JSON.parse(fd.get('engagement_ids') as string)).toEqual([])
  })
})
