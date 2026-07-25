import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = join(root, 'supabase/migrations/238_last_organization_admin.sql')
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const actions = readFileSync(join(root, 'app/admin/organisations/actions.ts'), 'utf8')
const organisations = readFileSync(join(root, 'lib/db/organisations.ts'), 'utf8')

describe('M4b-0C1 — protection du dernier administrateur organisationnel', () => {
  it('protège les UPDATE et DELETE au niveau PostgreSQL', () => {
    expect(existsSync(migrationPath)).toBe(true)
    expect(migration).toMatch(/for update/i)
    expect(migration).toMatch(/count\(\*\)[\s\S]{0,260}role\s*=\s*'admin'[\s\S]{0,260}status\s*=\s*'active'/i)
    expect(migration).toMatch(/before update of role, status, organization_id, user_id or delete/i)
    expect(migration).toMatch(/last active organization administrator/i)
  })

  it('protège chaque mutation serveur sensible', () => {
    expect(actions).toMatch(/assignOrganizationRoleAction/)
    expect(actions).toMatch(/suspendOrganizationMembershipAction/)
    expect(actions).toMatch(/removeOrganizationMembershipAction/)
    expect(actions).toMatch(/organization_membership_last_admin/i)
  })

  it('sépare les trois opérations métier', () => {
    expect(organisations).toMatch(/updateOrganizationMembershipRole/)
    expect(organisations).toMatch(/suspendOrganizationMembership/)
    expect(organisations).toMatch(/removeOrganizationMembership/)
  })

  it('audite les acceptations et les refus avec le périmètre organisationnel', () => {
    expect(actions).toMatch(/result:\s*'accepted'/)
    expect(actions).toMatch(/result:\s*'rejected'/)
    expect(actions).toMatch(/organization_id/)
    expect(actions).toMatch(/reason/)
  })
})
