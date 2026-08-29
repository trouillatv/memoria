import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/370_site_planning_items.sql'), 'utf8')
const repository = readFileSync(resolve(process.cwd(), 'lib/db/site-planning-items.ts'), 'utf8')

describe('schéma durable Planning V1-A', () => {
  it('ferme les dimensions métier et conserve des dates civiles', () => {
    expect(migration).toContain("kind in ('task', 'milestone')")
    expect(migration).toContain("status in ('planned', 'superseded', 'cancelled')")
    expect(migration).toContain("temporal_precision in ('day', 'week', 'range', 'unknown')")
    expect(migration).toContain("date_basis in ('explicit_document', 'document_context', 'human_confirmed')")
    expect(migration).toContain('planned_end >= planned_start')
    expect(migration).not.toContain('due_date')
    expect(migration).not.toContain('completed_at')
    expect(migration).toMatch(/planned_start\s+date/)
    expect(migration).toMatch(/planned_end\s+date/)
  })

  it('protège le périmètre, la provenance et les versions', () => {
    expect(migration).toContain('supersedes_id')
    expect(migration).toContain('supersession inter-organisation/chantier interdite')
    expect(migration).toContain('boucle de supersession interdite')
    expect(migration).toContain("provenance source d''un autre périmètre")
    expect(migration).toContain('enable row level security')
    expect(migration).toContain('service_role_full_access')
    for (const index of ['site_planning_items_site_idx', 'site_planning_items_org_idx', 'site_planning_items_start_idx', 'site_planning_items_status_idx', 'site_planning_items_source_proposal_idx', 'site_planning_items_subject_idx', 'site_planning_items_supersedes_idx']) expect(migration).toContain(index)
  })

  it('expose les primitives repository sans notion due/completed', () => {
    for (const method of ['createPlanningItem', 'listSitePlanningItems', 'getPlanningItem', 'supersedePlanningItem', 'cancelPlanningItem']) expect(repository).toContain(`export async function ${method}`)
    expect(repository).not.toContain('dueDate')
    expect(repository).not.toContain('completedAt')
    expect(repository).toContain(".in('status', statuses)")
  })
})
