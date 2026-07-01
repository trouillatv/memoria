// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Tests minimaux des composants de la page /equipes.
//
// On vérifie :
//   - TeamBadge : rendu (nom + classes couleur safe-listed)
//   - CreateTeamButton : ouverture du dialog, validation, submit appelle l'action
//   - EditTeamMembersDialog : liste membres, filtre des candidats, submit add/remove
//
// Les server actions sont mockées — on s'intéresse à la forme des appels, pas au
// comportement DB (déjà couvert par tests/lib/teams.test.ts en Slice 9.1).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TeamBadge } from '@/components/ui/team-badge'
import { CreateTeamButton } from '@/app/(dashboard)/equipes/CreateTeamButton'
import { EditTeamMembersDialog } from '@/app/(dashboard)/equipes/EditTeamMembersDialog'
import type { MemberLite } from '@/app/(dashboard)/equipes/EditTeamMembersDialog'

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

type ActionResult = { ok: boolean; error?: string; teamId?: string }

const {
  createTeamMock,
  addMemberMock,
  removeMemberMock,
  archiveTeamMock,
  updateTeamMock,
  toastSuccess,
  toastError,
  routerRefresh,
} = vi.hoisted(() => ({
  createTeamMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true, teamId: 't-1' })),
  addMemberMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  removeMemberMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  archiveTeamMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  updateTeamMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('@/app/(dashboard)/equipes/actions', () => ({
  createTeamAction: (input: unknown) => createTeamMock(input),
  addMemberToTeamAction: (input: unknown) => addMemberMock(input),
  removeMemberFromTeamAction: (input: unknown) => removeMemberMock(input),
  archiveTeamAction: (input: unknown) => archiveTeamMock(input),
  updateTeamAction: (input: unknown) => updateTeamMock(input),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
}))

// confirm() — utilisé par EditTeamMembersDialog.handleRemove
beforeEach(() => {
  createTeamMock.mockClear()
  addMemberMock.mockClear()
  removeMemberMock.mockClear()
  archiveTeamMock.mockClear()
  updateTeamMock.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
  routerRefresh.mockClear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

// ----------------------------------------------------------------------------
// TeamBadge
// ----------------------------------------------------------------------------

describe('TeamBadge', () => {
  it('affiche le nom de l’équipe', () => {
    render(<TeamBadge name="Alpha" />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('utilise la couleur slate (neutre) sans color fourni', () => {
    render(<TeamBadge name="Beta" />)
    const el = screen.getByText('Beta')
    expect(el.getAttribute('data-team-color')).toBe('slate')
    expect(el.className).toMatch(/slate/)
  })

  it('applique la classe couleur quand color valide est fourni', () => {
    render(<TeamBadge name="Gamma" color="emerald" />)
    const el = screen.getByText('Gamma')
    expect(el.getAttribute('data-team-color')).toBe('emerald')
    expect(el.className).toMatch(/emerald/)
  })

  it('retombe sur slate si color non whitelisté', () => {
    render(<TeamBadge name="Delta" color="not-a-color" />)
    const el = screen.getByText('Delta')
    expect(el.className).toMatch(/slate/)
  })

  it('respecte la taille md (padding plus large)', () => {
    render(<TeamBadge name="Eps" size="md" />)
    const el = screen.getByText('Eps')
    expect(el.className).toMatch(/px-2\.5/)
  })
})

// ----------------------------------------------------------------------------
// CreateTeamButton
// ----------------------------------------------------------------------------

describe('CreateTeamButton', () => {
  it('rend un bouton "Nouvelle équipe" fermé par défaut', () => {
    render(<CreateTeamButton />)
    expect(screen.getByTestId('create-team-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('team-name-input')).not.toBeInTheDocument()
  })

  it('ouvre le dialog au clic et affiche le formulaire', () => {
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    expect(screen.getByTestId('team-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('create-team-submit')).toBeInTheDocument()
  })

  it('désactive le submit tant que le nom est vide', () => {
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    const submit = screen.getByTestId('create-team-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('active le submit dès qu’un nom est saisi', () => {
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    fireEvent.change(screen.getByTestId('team-name-input'), {
      target: { value: 'Alpha' },
    })
    const submit = screen.getByTestId('create-team-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('appelle createTeamAction avec name (et color=null par défaut)', async () => {
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    fireEvent.change(screen.getByTestId('team-name-input'), {
      target: { value: 'Alpha' },
    })
    fireEvent.click(screen.getByTestId('create-team-submit'))

    await waitFor(() => {
      expect(createTeamMock).toHaveBeenCalledTimes(1)
    })
    const arg = createTeamMock.mock.calls[0]?.[0] as { name: string; color: string | null }
    expect(arg.name).toBe('Alpha')
    expect(arg.color).toBeNull()
  })

  it('transmet la couleur sélectionnée à l’action', async () => {
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    fireEvent.change(screen.getByTestId('team-name-input'), {
      target: { value: 'Beta' },
    })
    // Le color picker libre (Sprint Équipes) expose des swatches hex :
    // « Émeraude » = #10B981 → test-id team-color-swatch-10b981, valeur #10b981.
    fireEvent.click(screen.getByTestId('team-color-swatch-10b981'))
    fireEvent.click(screen.getByTestId('create-team-submit'))

    await waitFor(() => {
      expect(createTeamMock).toHaveBeenCalledTimes(1)
    })
    const arg = createTeamMock.mock.calls[0]?.[0] as { name: string; color: string | null }
    expect(arg.color).toBe('#10b981')
  })

  it('affiche un toast d’erreur si l’action échoue', async () => {
    createTeamMock.mockResolvedValueOnce({ ok: false, error: 'Une équipe avec ce nom existe déjà' })
    render(<CreateTeamButton />)
    fireEvent.click(screen.getByTestId('create-team-trigger'))
    fireEvent.change(screen.getByTestId('team-name-input'), {
      target: { value: 'Alpha' },
    })
    fireEvent.click(screen.getByTestId('create-team-submit'))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Une équipe avec ce nom existe déjà')
    })
  })
})

// ----------------------------------------------------------------------------
// EditTeamMembersDialog
// ----------------------------------------------------------------------------

const members: MemberLite[] = [
  { id: 'u-1', name: 'Mehdi', email: 'mehdi@example.com' },
  { id: 'u-2', name: 'Léa', email: 'lea@example.com' },
]
const availableUsers: MemberLite[] = [
  ...members,
  { id: 'u-3', name: 'Karim', email: 'karim@example.com' },
  { id: 'u-4', name: 'Sarah', email: 'sarah@example.com' },
]

describe('EditTeamMembersDialog', () => {
  it('rend un trigger fermé par défaut', () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={members}
        availableUsers={availableUsers}
      />
    )
    expect(screen.getByTestId('edit-members-trigger-t-1')).toBeInTheDocument()
    expect(screen.queryByTestId('team-members-list')).not.toBeInTheDocument()
  })

  it('affiche les membres actuels au clic sur Éditer', () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={members}
        availableUsers={availableUsers}
      />
    )
    fireEvent.click(screen.getByTestId('edit-members-trigger-t-1'))
    const list = screen.getByTestId('team-members-list')
    expect(within(list).getByText('Mehdi')).toBeInTheDocument()
    expect(within(list).getByText('Léa')).toBeInTheDocument()
  })

  it('expose le titre du dialog avec le nom de l’équipe', () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={members}
        availableUsers={availableUsers}
      />
    )
    fireEvent.click(screen.getByTestId('edit-members-trigger-t-1'))
    expect(screen.getByText(/composition — alpha/i)).toBeInTheDocument()
  })

  it('appelle removeMemberFromTeamAction avec le bon userId', async () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={members}
        availableUsers={availableUsers}
      />
    )
    fireEvent.click(screen.getByTestId('edit-members-trigger-t-1'))
    fireEvent.click(screen.getByTestId('remove-member-u-1'))
    await waitFor(() => {
      expect(removeMemberMock).toHaveBeenCalledTimes(1)
    })
    const arg = removeMemberMock.mock.calls[0]?.[0] as { teamId: string; userId: string }
    expect(arg.teamId).toBe('t-1')
    expect(arg.userId).toBe('u-1')
  })

  it('affiche un message quand il n’y a aucun candidat à ajouter', () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={members}
        availableUsers={members /* tous déjà membres */}
      />
    )
    fireEvent.click(screen.getByTestId('edit-members-trigger-t-1'))
    expect(screen.getByText(/aucune personne disponible/i)).toBeInTheDocument()
    expect(screen.queryByTestId('add-member-submit')).not.toBeInTheDocument()
  })

  it('affiche un message quand l’équipe n’a aucun membre', () => {
    render(
      <EditTeamMembersDialog
        teamId="t-1"
        teamName="Alpha"
        members={[]}
        availableUsers={availableUsers}
      />
    )
    fireEvent.click(screen.getByTestId('edit-members-trigger-t-1'))
    expect(screen.getByText(/aucun membre pour l’instant/i)).toBeInTheDocument()
  })
})
