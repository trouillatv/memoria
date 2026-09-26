import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

function extractBlock(src: string, marker: string): string {
  const idx = src.indexOf(marker)
  if (idx === -1) return ''
  const tail = src.slice(idx)
  const next = tail.slice(marker.length).search(/\n(export |create or replace function )/)
  return next === -1 ? tail : tail.slice(0, marker.length + next)
}

describe('PLAN-INTEG-1 - source active SIMPLE XOR ROULEMENT', () => {
  const migration = read('supabase/migrations/442_plan_integ_1_rhythm_exclusivity.sql')
  const recurrences = read('app/(dashboard)/contracts/[id]/recurrences-actions.ts')
  const cycles = read('app/(dashboard)/sites/[id]/roulements/actions.ts')

  it('definit le simple actif par intervention_templates actif, non supprime, cycle_id null', () => {
    expect(migration).toContain("t.deleted_at is null")
    expect(migration).toContain("t.active is true")
    expect(migration).toContain("t.cycle_id is null")
  })

  it('definit le roulement actif par planning_cycles published courant, sans regarder les templates derives', () => {
    const guard = extractBlock(migration, 'create or replace function public.plan_integ_simple_cycle_conflict_guard')
    expect(guard).toContain("c.status = 'published'")
    expect(guard).toContain('c.deleted_at is null')
    expect(guard).toContain('plan_integ_periods_overlap')
    expect(guard).not.toContain('cycle_id is not null')
  })

  it('compte un cycle published sans template derive comme roulement actif', () => {
    const publishRpc = extractBlock(migration, 'create or replace function public.fn_plan_publish_cycle_exclusive')
    expect(publishRpc).toContain("where id = p_cycle_id")
    expect(publishRpc).toContain("status = 'published'")
    expect(publishRpc).not.toMatch(/from public\.intervention_templates[\s\S]{0,160}cycle_id is not null/)
  })

  it('bloque les ecritures directes par trigger DB deferrable sur les deux tables', () => {
    expect(migration).toContain('create constraint trigger plan_integ_simple_guard')
    expect(migration).toContain('on public.intervention_templates')
    expect(migration).toContain('create constraint trigger plan_integ_cycle_guard')
    expect(migration).toContain('on public.planning_cycles')
    expect(migration).toContain('deferrable initially immediate')
  })

  it('les rythmes simples passent par les RPC transactionnelles de remplacement', () => {
    expect(recurrences).toContain("rpc(")
    expect(recurrences).toContain('fn_plan_create_simple_template_exclusive')
    expect(recurrences).toContain('fn_plan_update_simple_template_exclusive')
    expect(recurrences).toContain('confirm_replace_cycle')
    expect(recurrences).toContain("conflict: 'replace_cycle_with_simple'")
  })

  it('la publication de roulement passe par la RPC exclusive et les brouillons restent autorises', () => {
    expect(cycles).toContain('fn_plan_publish_cycle_exclusive')
    expect(cycles).toContain('confirmReplaceRhythm')
    expect(cycles).toContain("conflict: 'replace_simple_with_cycle'")
    expect(cycles).toContain("d.status === 'published'")
  })

  it('la regeneration de projection archive les anciens templates et regenere depuis planning_cycle_slots', () => {
    const regenerate = extractBlock(migration, 'create or replace function public.fn_plan_regenerate_cycle_templates')
    expect(regenerate).toContain('update public.intervention_templates')
    expect(regenerate).toContain('set deleted_at = now()')
    expect(regenerate).toContain('from public.planning_cycle_slots s')
    expect(regenerate).toContain("s.state = 'work'")
  })
})
