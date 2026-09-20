import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/422_curate_subject_thread_identity_fn.sql'), 'utf8')
const WRAPPER = readFileSync(join(ROOT, 'lib/db/subject-thread-curation.ts'), 'utf8')
const HISTORICAL_RECONCILE = readFileSync(join(ROOT, 'lib/db/canonical-subject-historical-reconcile.ts'), 'utf8')
const SOURCE_RECONCILE = readFileSync(join(ROOT, 'lib/db/canonical-subject-source-reconcile.ts'), 'utf8')

describe('Axe B2 — curate_subject_thread_identity: move one isolated thread without merging Subjects', () => {
  it('moves a wrongly-attached thread to the correct target and records durable human provenance', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.subject_thread_identity[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id[\s\S]*source = 'manual'[\s\S]*reviewed_at = now\(\)[\s\S]*reviewed_by = p_user_id/)
    expect(MIGRATION).toMatch(/WHERE subject_thread_id = p_subject_thread_id[\s\S]{0,20}AND site_id = p_site_id;/)
    expect(MIGRATION).toContain("'thread_retargeted'")
    expect(MIGRATION).toContain('INSERT INTO public.canonical_subject_curation_event')
  })

  it('is idempotent: a second call to the same target is an explicit no-op, nothing rewritten', () => {
    expect(MIGRATION).toMatch(/IF v_previous_subject_id = p_target_canonical_subject_id THEN[\s\S]*RETURN jsonb_build_object\(\s*'ok', true,\s*'code', 'no_op'/)
  })

  it('refuses cross-site moves: thread lookup and target lookup are both scoped to p_site_id', () => {
    expect(MIGRATION).toMatch(/FROM public\.subject_thread_identity\s*WHERE subject_thread_id = p_subject_thread_id\s*AND site_id = p_site_id/)
    expect(MIGRATION).toContain("'thread_not_found'")
    expect(MIGRATION).toMatch(/FROM public\.canonical_subject\s*WHERE id = p_target_canonical_subject_id\s*AND site_id = p_site_id/)
  })

  it('refuses an invalid or inactive target Subject before writing anything', () => {
    expect(MIGRATION).toMatch(/status = 'active'[\s\S]*kind = 'business_subject'[\s\S]*company_id IS NULL[\s\S]*contact_id IS NULL/)
    expect(MIGRATION).toContain("'target_subject_not_found'")
  })

  it('never merges the source Subject: only the single named thread is targeted, never a canonical_subject_id-scoped bulk update', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.subject_thread_identity\s*SET canonical_subject_id = p_target_canonical_subject_id[\s\S]{0,400}WHERE subject_thread_id = p_subject_thread_id\s*AND site_id = p_site_id;/)
    expect(MIGRATION).not.toMatch(/UPDATE public\.subject_thread_identity[\s\S]{0,200}WHERE canonical_subject_id = /)
  })

  it('cascades Point/CBO only when a Point already exists and resolves unambiguously, never overwriting an active override', () => {
    expect(MIGRATION).toMatch(/SELECT 1 FROM public\.tracked_point_subject_override o[\s\S]*WHERE o\.tracked_point_id = v_point_id[\s\S]*AND o\.superseded_at IS NULL/)
    expect(MIGRATION).toMatch(/array_length\(v_point_resolved_subjects, 1\) = 1[\s\S]*v_point_resolved_subjects\[1\] = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id/)
  })

  it('resyncs only the documentary occurrences tied to this thread, deduping instead of creating twins', () => {
    expect(MIGRATION).toMatch(/dep\.subject_thread_id = p_subject_thread_id/)
    expect(MIGRATION).toMatch(/DELETE FROM public\.canonical_subject_occurrence old_occ/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_subject_occurrence occ\s*SET canonical_subject_id = p_target_canonical_subject_id/)
  })

  it('is future-proof against automatic reconciliation: every automatic writer upserts subject_thread_identity with ignoreDuplicates on the primary key', () => {
    expect(HISTORICAL_RECONCILE).toMatch(/\.from\('subject_thread_identity'\)\s*\.upsert\(\s*\{[\s\S]*source: 'auto'[\s\S]*\},\s*\{ onConflict: 'subject_thread_id', ignoreDuplicates: true \}/)
    expect(SOURCE_RECONCILE).toMatch(/\.from\('subject_thread_identity'\)\s*\.upsert\(\s*\{[\s\S]*source: 'auto',\s*\},\s*\{ onConflict: 'subject_thread_id', ignoreDuplicates: true \}/)
    expect(SOURCE_RECONCILE).toContain("l'upsert ci-dessus est en ignoreDuplicates")
  })

  it('exposes a matching TypeScript wrapper', () => {
    expect(WRAPPER).toContain('curateSubjectThreadIdentity')
    expect(WRAPPER).toContain("rpc('curate_subject_thread_identity'")
    expect(WRAPPER).toContain('p_subject_thread_id')
    expect(WRAPPER).toContain('p_target_canonical_subject_id')
  })
})
