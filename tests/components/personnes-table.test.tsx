import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonnesTable } from '@/app/admin/personnes/PersonnesTable'

vi.mock('@/app/admin/users/UserRoleSelect', () => ({ UserRoleSelect: () => null }))
vi.mock('@/app/admin/users/ForcePasswordResetButton', () => ({ ForcePasswordResetButton: () => null }))
vi.mock('@/app/admin/users/DeleteUserButton', () => ({ DeleteUserButton: () => null }))
vi.mock('@/app/admin/users/UserPhoneEdit', () => ({ UserPhoneEdit: () => null }))
vi.mock('@/app/admin/organisations/OrgForms', () => ({ MoveUserOrgForm: () => null }))

describe('PersonnesTable', () => {
  it('affiche toutes les organisations actives d’une personne', () => {
    render(
      <PersonnesTable
        orgs={[
          { id: 'agp', name: 'AGP' },
          { id: 'servinor', name: 'SERVINOR' },
        ]}
        rows={[{
          id: 'vincent',
          full_name: 'Vincent Trouillat',
          email: 'vincent.trouillat@memoria.nc',
          role: 'admin',
          organization_id: 'agp',
          organizationMemberships: [
            { organizationId: 'agp', role: 'admin', organizationName: 'AGP' },
            { organizationId: 'servinor', role: 'manager', organizationName: 'SERVINOR' },
          ],
          orgName: 'AGP',
          orgKnown: true,
          phone: null,
          lastActivityIso: null,
          status: 'inactive',
          mustChange: false,
          isSelf: true,
        }]}
      />,
    )

    expect(screen.getByText('AGP')).toBeInTheDocument()
    expect(screen.getByText('SERVINOR')).toBeInTheDocument()
    const memberships = screen.getAllByTestId('organization-membership')
    expect(memberships).toHaveLength(2)
    expect(memberships[0]).toHaveTextContent('AGP')
    expect(memberships[0]).toHaveTextContent('Admin')
    expect(memberships[1]).toHaveTextContent('SERVINOR')
    expect(memberships[1]).toHaveTextContent('Manager')
  })
})
