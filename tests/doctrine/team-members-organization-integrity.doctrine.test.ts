import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationPath = join(root, 'supabase/migrations/237_team_members_org_integrity.sql')
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const teams = readFileSync(join(root, 'lib/db/teams.ts'), 'utf8')
const teamsPage = readFileSync(join(root, 'app/(dashboard)/equipes/page.tsx'), 'utf8')

describe('team_members organisation integrity', () => {
  it('publishes the defensive migration', () => {
    expect(existsSync(migrationPath)).toBe(true)
    expect(migration).toMatch(/alter table public\.team_members[\s\S]{0,120}organization_id\s+set\s+not\s+null/i)
    expect(migration).toMatch(/organization_id\s+set\s+not\s+null/i)
    expect(migration).toMatch(/foreign key\s*\(team_id, organization_id\)/i)
  })

  it('protects active team memberships with a database trigger', () => {
    expect(migration).toMatch(/create trigger[^;]+team_members/i)
    expect(migration).toMatch(/organization_memberships/i)
    expect(migration).toMatch(/left_at/i)
  })

  it('archives team memberships when organization access stops being active', () => {
    expect(migration).toMatch(/create trigger[^;]+organization_memberships/i)
    expect(migration).toMatch(/status[^;]+active/i)
    expect(migration).toMatch(/update public\.team_members/i)
    expect(migration).toMatch(/left_at\s*=\s*coalesce\(left_at/i)
  })

  it('writes the team organization and validates the target user membership', () => {
    expect(teams).toMatch(/organization_id\s*:/)
    expect(teams).toMatch(/organization_memberships/)
    expect(teams).toMatch(/status.*active|active.*status/s)
  })

  it('loads team candidates from organization memberships, not the legacy user column', () => {
    expect(teamsPage).toMatch(/organization_memberships/)
    expect(teamsPage).not.toMatch(/\.from\(['"]users['"]\)[\s\S]{0,220}organization_id[\s\S]{0,220}\.in\(['"]organization_id['"]/)
  })
})
