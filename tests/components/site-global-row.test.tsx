// /sites — ligne de synthèse chantier (métadonnée du modèle ACTUEL).
// Contrat verrouillé : visites terrain · actions (total) · PV importés · dernière
// visite ; chaque métrique seulement si > 0 ; PLUS de mission/intervention/note
// (vocabulaire maintenance, retiré de l'affichage — les champs restent en base
// pour la protection de suppression, non testés ici).

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SiteGlobalRow } from '@/app/(dashboard)/sites/SiteGlobalRow'
import type { SiteWithStats } from '@/lib/db/sites'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/(dashboard)/sites/actions', () => ({
  updateSiteGlobalAction: vi.fn(), deleteSiteAction: vi.fn(),
}))

function makeSite(over: Partial<SiteWithStats> = {}): SiteWithStats {
  return {
    id: 's1', client_id: 'c1', contract_id: null, name: 'Vila Dovant', address: null, notes: null,
    phase: 'actif', access_code: null, alarm_code: null, contact_name: null, contact_phone: null,
    access_hours: null, access_instructions: null, created_at: '2026-01-01T00:00:00Z', deleted_at: null,
    contract_name: null, contract_status: null, client_display_name: null, client_logo_url: null,
    site_logo_url: null,
    last_intervention_at: null, missions_count: 0, interventions_count: 0, site_notes_count: 0,
    visites_count: 0, last_visit_at: null, actions_count: 0, pv_imported_count: 0,
    ...over,
  }
}

function meta(): HTMLElement {
  // La ligne méta est le dernier bloc bordé de la carte.
  return screen.getByText('Vila Dovant').closest('li')!
}

describe('SiteGlobalRow — ligne de synthèse (modèle actuel)', () => {
  it('chantier avec visites : « N visites · N actions · N PV importés · Dernière visite »', () => {
    render(<SiteGlobalRow site={makeSite({ visites_count: 4, actions_count: 8, pv_imported_count: 3, last_visit_at: '2026-08-31T06:00:00Z' })} />)
    const card = meta()
    expect(within(card).getByText('4 visites')).toBeInTheDocument()
    expect(within(card).getByText('8 actions')).toBeInTheDocument()
    expect(within(card).getByText('3 PV importés')).toBeInTheDocument()
    expect(within(card).getByText(/Dernière visite/)).toBeInTheDocument()
  })

  it('chantier sans visite (BELLA) : « N actions · N PV importés », sans « Dernière visite »', () => {
    render(<SiteGlobalRow site={makeSite({ name: 'BELLA NAPOLI', visites_count: 0, actions_count: 8, pv_imported_count: 3 })} />)
    const card = screen.getByText('BELLA NAPOLI').closest('li')!
    expect(within(card).getByText('8 actions')).toBeInTheDocument()
    expect(within(card).getByText('3 PV importés')).toBeInTheDocument()
    expect(within(card).queryByText(/visite/)).not.toBeInTheDocument()
  })

  it('ne montre JAMAIS mission / intervention / note (vocabulaire maintenance retiré)', () => {
    render(<SiteGlobalRow site={makeSite({ visites_count: 4, actions_count: 8, pv_imported_count: 3, missions_count: 2, interventions_count: 1, site_notes_count: 3, last_visit_at: '2026-08-31T06:00:00Z' })} />)
    const card = meta()
    expect(within(card).queryByText(/mission/i)).not.toBeInTheDocument()
    expect(within(card).queryByText(/intervention/i)).not.toBeInTheDocument()
    expect(within(card).queryByText(/\bnotes?\b/i)).not.toBeInTheDocument()
  })

  it('singulier correct à 1', () => {
    render(<SiteGlobalRow site={makeSite({ visites_count: 1, actions_count: 1, pv_imported_count: 1, last_visit_at: '2026-08-31T06:00:00Z' })} />)
    const card = meta()
    expect(within(card).getByText('1 visite')).toBeInTheDocument()
    expect(within(card).getByText('1 action')).toBeInTheDocument()
    expect(within(card).getByText('1 PV importé')).toBeInTheDocument()
  })

  it('chantier vide : aucune métrique affichée (pas de rangée de zéros)', () => {
    render(<SiteGlobalRow site={makeSite({ name: 'Neuf' })} />)
    const card = screen.getByText('Neuf').closest('li')!
    expect(within(card).queryByText(/\d+ (visite|action|PV)/)).not.toBeInTheDocument()
  })
})
