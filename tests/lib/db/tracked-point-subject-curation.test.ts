import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/417_tracked_point_subject_curation.sql'), 'utf8')
const REDEPLOY = readFileSync(join(ROOT, 'supabase/migrations/418_redeploy_tracked_point_subject_curation_fn.sql'), 'utf8')
const COMPLETE = readFileSync(join(ROOT, 'supabase/migrations/419_subject_curation_complete.sql'), 'utf8')
const WRAPPER = readFileSync(join(ROOT, 'lib/db/tracked-point-subject-curation.ts'), 'utf8')

describe('tracked point subject curation', () => {
  it('audits a durable human override instead of patching only tracked_point', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.tracked_point_subject_override')
    expect(MIGRATION).toContain('previous_canonical_subject_id')
    expect(MIGRATION).toContain('target_canonical_subject_id')
    expect(MIGRATION).toContain('subject_thread_ids')
    expect(MIGRATION).toContain('affected_counts')
    expect(MIGRATION).toContain('tracked_point_subject_override_active_uidx')
  })

  it('reroutes the source thread as a manual decision', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.subject_thread_identity[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/source = 'manual'/)
    expect(MIGRATION).toMatch(/reviewed_at = now\(\)/)
    expect(MIGRATION).toMatch(/reviewed_by = p_user_id/)
    expect(MIGRATION).toContain('invalid_thread_identity')
  })

  it('syncs already materialized business projections', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point_member[\s\S]*resolution_source = 'manual'/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_business_object[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_actions[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_deadlines[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_reserve[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
  })

  it('redeploys the RPC without writing a non-existent site_actions.updated_at column', () => {
    const actionBlock = REDEPLOY.match(/UPDATE public\.site_actions sa[\s\S]*?RETURNING sa\.id/)?.[0] ?? ''
    expect(REDEPLOY).toContain('CREATE OR REPLACE FUNCTION public.curate_tracked_point_subject')
    expect(actionBlock).toContain('SET canonical_subject_id = p_target_canonical_subject_id')
    expect(actionBlock).not.toContain('updated_at')
  })

  it('moves historical occurrences without reintroducing deleted sources', () => {
    expect(MIGRATION).toMatch(/JOIN public\.documents d[\s\S]*d\.deleted_at IS NULL/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_subject_occurrence occ[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toContain('target_occ.id <> old_occ.id')
    expect(MIGRATION).toContain('canonicalSubjectOccurrenceMoved')
    expect(MIGRATION).toContain('canonicalSubjectOccurrenceDeduped')
  })

  it('keeps the original move RPC from opportunistically creating Points or Subjects', () => {
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.tracked_point\b/)
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.canonical_subject\b/)
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.canonical_business_object\b/)
  })

  it('supports a manually detached subject without a fake placeholder Subject', () => {
    expect(COMPLETE).toContain('ALTER COLUMN target_canonical_subject_id DROP NOT NULL')
    expect(COMPLETE).toContain("curation_kind IN ('target_subject', 'detached', 'created_subject')")
    expect(COMPLETE).toMatch(/SET canonical_subject_id = p_target_canonical_subject_id[\s\S]*WHERE id = p_tracked_point_id/)
    expect(COMPLETE).not.toContain("label = 'Sans sujet'")
  })

  it('creates a business Subject from a Point then reuses the durable curation primitive', () => {
    expect(COMPLETE).toContain('CREATE OR REPLACE FUNCTION public.create_subject_from_tracked_point')
    expect(COMPLETE).toMatch(/INSERT INTO public\.canonical_subject[\s\S]*'manual'[\s\S]*'business_subject'/)
    expect(COMPLETE).toContain('public.curate_tracked_point_subject(')
    expect(COMPLETE).toContain('duplicate_subject')
  })

  it('renames without changing identity and keeps the previous label as an alias', () => {
    expect(COMPLETE).toContain('CREATE OR REPLACE FUNCTION public.rename_canonical_subject_manual')
    expect(COMPLETE).toMatch(/SET label = v_new_label,[\s\S]*aliases = v_aliases,[\s\S]*source = 'manual'/)
    expect(COMPLETE).toMatch(/coalesce\(v_subject\.aliases[\s\S]*ARRAY\[v_subject\.label\]/)
    expect(COMPLETE).toContain("event_type, previous_label, new_label")
  })

  it('merges through merged_into while rerouting Points and business objects', () => {
    expect(COMPLETE).toContain('CREATE OR REPLACE FUNCTION public.merge_canonical_subjects_manual')
    expect(COMPLETE).toContain('public.merge_canonical_subjects(p_source_canonical_subject_id, p_target_canonical_subject_id)')
    expect(COMPLETE).toMatch(/UPDATE public\.tracked_point[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(COMPLETE).toMatch(/UPDATE public\.site_actions[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(COMPLETE).toMatch(/UPDATE public\.site_deadlines[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(COMPLETE).toMatch(/UPDATE public\.site_reserve[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(COMPLETE).toContain("v_source.status = 'merged' AND v_source.merged_into = p_target_canonical_subject_id")
  })

  it('exposes fine TypeScript wrappers for the transaction RPCs', () => {
    expect(WRAPPER).toContain('curateTrackedPointSubject')
    expect(WRAPPER).toContain("rpc('curate_tracked_point_subject'")
    expect(WRAPPER).toContain('createSubjectFromTrackedPoint')
    expect(WRAPPER).toContain('renameCanonicalSubjectManual')
    expect(WRAPPER).toContain('mergeCanonicalSubjectsManual')
    expect(WRAPPER).toContain('CurateTrackedPointSubjectResult')
    expect(WRAPPER).toContain('invalid_thread_identity')
  })
})
