import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AccountProfileForm } from '@/app/(dashboard)/account/AccountProfileForm'
import { AccountPasswordForm } from '@/app/(dashboard)/account/AccountPasswordForm'
import { HomePreferenceToggle } from '@/app/(dashboard)/account/HomePreferenceToggle'

// Mock the server actions + sonner.toast — hoisted refs so vi.mock factories see them.
type ActionResult = { ok: boolean; error?: string }
const {
  updateProfileMock,
  updateHomePreferenceMock,
  applyHomePreferenceAndLogoutMock,
  changePasswordMock,
  logoutMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  updateProfileMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  updateHomePreferenceMock: vi.fn<(pref: 'dashboard' | 'terrain') => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  applyHomePreferenceAndLogoutMock: vi.fn<(pref: 'dashboard' | 'terrain') => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  changePasswordMock: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true })),
  logoutMock: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/(dashboard)/account/actions', () => ({
  updateProfileAction: (input: unknown) => updateProfileMock(input),
  updateHomePreferenceAction: (pref: 'dashboard' | 'terrain') => updateHomePreferenceMock(pref),
  applyHomePreferenceAndLogoutAction: (pref: 'dashboard' | 'terrain') => applyHomePreferenceAndLogoutMock(pref),
  changePasswordAction: (input: unknown) => changePasswordMock(input),
  logoutAction: () => logoutMock(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

describe('AccountProfileForm', () => {
  beforeEach(() => {
    updateProfileMock.mockClear()
    toastSuccess.mockClear()
    toastError.mockClear()
    updateProfileMock.mockResolvedValue({ ok: true })
  })

  it('renders the initial full name and disables Save when not dirty', () => {
    render(
      <AccountProfileForm
        initialFullName="Jean Dupont"
        initialPhone={null}
        email="jean@example.com"
        roleLabel="Manager"
      />,
    )
    const input = screen.getByLabelText(/nom complet/i) as HTMLInputElement
    expect(input.value).toBe('Jean Dupont')
    const button = screen.getByRole('button', { name: /enregistrer/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows email and role as disabled inputs', () => {
    render(
      <AccountProfileForm
        initialFullName="Jean Dupont"
        initialPhone={null}
        email="jean@example.com"
        roleLabel="Manager"
      />,
    )
    const email = screen.getByLabelText(/email/i) as HTMLInputElement
    expect(email.value).toBe('jean@example.com')
    expect(email.disabled).toBe(true)
    const role = screen.getByLabelText(/rôle/i) as HTMLInputElement
    expect(role.value).toBe('Manager')
    expect(role.disabled).toBe(true)
  })

  it('enables Save when the name is changed', () => {
    render(
      <AccountProfileForm
        initialFullName="Jean Dupont"
        initialPhone={null}
        email="jean@example.com"
        roleLabel="Manager"
      />,
    )
    const input = screen.getByLabelText(/nom complet/i)
    fireEvent.change(input, { target: { value: 'Jean Dupond' } })
    const button = screen.getByRole('button', { name: /enregistrer/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('calls updateProfileAction with the trimmed value on submit', async () => {
    render(
      <AccountProfileForm
        initialFullName="Jean Dupont"
        initialPhone={null}
        email="jean@example.com"
        roleLabel="Manager"
      />,
    )
    const input = screen.getByLabelText(/nom complet/i)
    fireEvent.change(input, { target: { value: 'Marie Curie' } })
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }))
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(1)
    })
    // Sprint 4 PC — la signature inclut désormais `phone` (chaîne vide = pas
    // de modification effective, mais le champ est toujours envoyé).
    expect(updateProfileMock).toHaveBeenCalledWith({ full_name: 'Marie Curie', phone: '' })
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Profil mis à jour.')
    })
  })

  it('shows an error toast when the server returns ok:false', async () => {
    updateProfileMock.mockResolvedValueOnce({ ok: false, error: 'Boom' })
    render(
      <AccountProfileForm
        initialFullName="Jean Dupont"
        initialPhone={null}
        email="jean@example.com"
        roleLabel="Manager"
      />,
    )
    fireEvent.change(screen.getByLabelText(/nom complet/i), {
      target: { value: 'Marie Curie' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }))
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Boom')
    })
  })
})

describe('HomePreferenceToggle', () => {
  beforeEach(() => {
    updateHomePreferenceMock.mockClear()
    applyHomePreferenceAndLogoutMock.mockClear()
    toastSuccess.mockClear()
    toastError.mockClear()
    updateHomePreferenceMock.mockResolvedValue({ ok: true })
    applyHomePreferenceAndLogoutMock.mockResolvedValue({ ok: true })
  })

  it('selects a home preference locally then applies it with logout', async () => {
    render(<HomePreferenceToggle current="terrain" />)

    fireEvent.click(screen.getByRole('button', { name: /tableau de bord/i }))

    expect(updateHomePreferenceMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /tableau de bord/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /vue terrain/i })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: /appliquer/i }))

    await waitFor(() => {
      expect(applyHomePreferenceAndLogoutMock).toHaveBeenCalledWith('dashboard')
    })
    expect(updateHomePreferenceMock).not.toHaveBeenCalled()
  })
})

describe('AccountPasswordForm', () => {
  beforeEach(() => {
    changePasswordMock.mockClear()
    toastSuccess.mockClear()
    toastError.mockClear()
    changePasswordMock.mockResolvedValue({ ok: true })
  })

  it('keeps the Submit button disabled when fields are empty', () => {
    render(<AccountPasswordForm />)
    const button = screen.getByRole('button', { name: /modifier le mot de passe/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows a "too short" hint when new password is < 8 chars and keeps button disabled', () => {
    render(<AccountPasswordForm />)
    fireEvent.change(screen.getByLabelText(/mot de passe actuel/i), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^nouveau mot de passe$/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/confirmer le nouveau mot de passe/i), {
      target: { value: 'short' },
    })
    expect(screen.getByText(/au moins 8 caractères/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /modifier le mot de passe/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows a mismatch hint when confirm != new and keeps button disabled', () => {
    render(<AccountPasswordForm />)
    fireEvent.change(screen.getByLabelText(/mot de passe actuel/i), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^nouveau mot de passe$/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmer le nouveau mot de passe/i), {
      target: { value: 'different' },
    })
    expect(screen.getByText(/ne correspondent pas/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /modifier le mot de passe/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('enables Submit when all fields are valid and matching', () => {
    render(<AccountPasswordForm />)
    fireEvent.change(screen.getByLabelText(/mot de passe actuel/i), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^nouveau mot de passe$/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmer le nouveau mot de passe/i), {
      target: { value: 'newpass123' },
    })
    const button = screen.getByRole('button', { name: /modifier le mot de passe/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('calls changePasswordAction with current + new on submit and clears fields on success', async () => {
    render(<AccountPasswordForm />)
    fireEvent.change(screen.getByLabelText(/mot de passe actuel/i), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^nouveau mot de passe$/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmer le nouveau mot de passe/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /modifier le mot de passe/i }))
    await waitFor(() => {
      expect(changePasswordMock).toHaveBeenCalledTimes(1)
    })
    expect(changePasswordMock).toHaveBeenCalledWith({
      current_password: 'oldpass1',
      new_password: 'newpass123',
    })
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Mot de passe modifié.')
    })
    // Fields cleared
    expect((screen.getByLabelText(/mot de passe actuel/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^nouveau mot de passe$/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/confirmer le nouveau mot de passe/i) as HTMLInputElement).value).toBe('')
  })

  it('renders an inline error block when the server returns ok:false', async () => {
    changePasswordMock.mockResolvedValueOnce({ ok: false, error: 'Mot de passe actuel incorrect.' })
    render(<AccountPasswordForm />)
    fireEvent.change(screen.getByLabelText(/mot de passe actuel/i), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByLabelText(/^nouveau mot de passe$/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.change(screen.getByLabelText(/confirmer le nouveau mot de passe/i), {
      target: { value: 'newpass123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /modifier le mot de passe/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/mot de passe actuel incorrect/i)
    })
  })
})
