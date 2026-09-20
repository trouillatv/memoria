import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/421_resync_orphaned_tracked_points_fn.sql'), 'utf8')
const WRAPPER = readFileSync(join(ROOT, 'lib/db/tracked-point-subject-resync.ts'), 'utf8')
const POST_PROCESSING = readFileSync(join(ROOT, 'lib/subjects/historical-import-post-processing.ts'), 'utf8')

describe('Axe B — resync orphaned tracked_point after late canonical reconciliation', () => {
  it('scopes strictly to Points still without a canonical Subject', () => {
    expect(MIGRATION).toMatch(/WHERE tp\.site_id = p_site_id[\s\S]*AND tp\.status = 'active'[\s\S]*AND tp\.canonical_subject_id IS NULL/)
    expect(MIGRATION).not.toMatch(/UPDATE public\.tracked_point[\s\S]{0,80}WHERE[\s\S]{0,120}canonical_subject_id IS NOT NULL/)
  })

  it('never overwrites a Point locked by an active human override', () => {
    expect(MIGRATION).toMatch(/SELECT 1 FROM public\.tracked_point_subject_override o[\s\S]*WHERE o\.tracked_point_id = v_point\.id[\s\S]*AND o\.superseded_at IS NULL/)
    expect(MIGRATION).toContain("out_verdict := 'skipped_locked'")
    expect(MIGRATION).toContain("override actif (curation humaine) — jamais écrasé")
  })

  it('only resolves when every active thread membership agrees on exactly one canonical Subject', () => {
    expect(MIGRATION).toMatch(/tpm\.status = 'active'[\s\S]*AND tpm\.scope = 'thread'/)
    expect(MIGRATION).toContain("out_verdict := 'skipped_unresolved'")
    expect(MIGRATION).toContain("out_verdict := 'skipped_ambiguous'")
    expect(MIGRATION).toMatch(/array_length\(v_resolved_subjects, 1\) > 1/)
  })

  it('validates the resolved target Subject before writing anything', () => {
    expect(MIGRATION).toMatch(/cs\.status = 'active'[\s\S]*AND cs\.kind = 'business_subject'[\s\S]*AND cs\.company_id IS NULL[\s\S]*AND cs\.contact_id IS NULL/)
    expect(MIGRATION).toContain("out_verdict := 'skipped_target_invalid'")
  })

  it('cascades exactly like the manual curation RPC, without touching occurrences or human-decision markers', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point[\s\S]*SET canonical_subject_id = v_target/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_business_object[\s\S]*SET canonical_subject_id = v_target/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_actions sa[\s\S]*SET canonical_subject_id = v_target/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_deadlines sd[\s\S]*SET canonical_subject_id = v_target/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_reserve sr[\s\S]*SET canonical_subject_id = v_target/)
    expect(MIGRATION).not.toMatch(/UPDATE public\.canonical_subject_occurrence/)
    expect(MIGRATION).not.toContain('INSERT INTO public.tracked_point_subject_override')
    expect(MIGRATION).not.toContain("source = 'manual'")
    expect(MIGRATION).not.toContain("resolution_source = 'manual'")
  })

  it('is idempotent by construction and exposes a matching TypeScript wrapper', () => {
    expect(MIGRATION).toContain('canonical_subject_id IS NULL')
    const returnsTableBlock = MIGRATION.match(/RETURNS TABLE\(([\s\S]*?)\)/)?.[1] ?? ''
    expect(returnsTableBlock).toContain('out_tracked_point_id')
    expect(returnsTableBlock).not.toMatch(/(?<!out_)\btracked_point_id\b/)
    expect(WRAPPER).toContain('resyncOrphanedTrackedPointsForSite')
    expect(WRAPPER).toContain("rpc('fn_resync_orphaned_tracked_points'")
    expect(WRAPPER).toContain('out_tracked_point_id')
    expect(POST_PROCESSING).toContain('resyncOrphanedTrackedPointsForSite')
    expect(POST_PROCESSING).toContain('resyncOrphanedTrackedPoints(siteId)')
  })
})
