import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/417_tracked_point_subject_curation.sql'), 'utf8')
const WRAPPER = readFileSync(join(ROOT, 'lib/db/tracked-point-subject-curation.ts'), 'utf8')

describe('tracked point subject curation', () => {
  it('audite un override humain durable au lieu de patcher seulement le Point', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.tracked_point_subject_override')
    expect(MIGRATION).toContain('previous_canonical_subject_id')
    expect(MIGRATION).toContain('target_canonical_subject_id')
    expect(MIGRATION).toContain('subject_thread_ids')
    expect(MIGRATION).toContain('affected_counts')
    expect(MIGRATION).toContain('tracked_point_subject_override_active_uidx')
  })

  it('reroute la vérité source du thread en décision manuelle', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.subject_thread_identity[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/source = 'manual'/)
    expect(MIGRATION).toMatch(/reviewed_at = now\(\)/)
    expect(MIGRATION).toMatch(/reviewed_by = p_user_id/)
    expect(MIGRATION).toContain('invalid_thread_identity')
  })

  it('synchronise les projections métier déjà matérialisées', () => {
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.tracked_point_member[\s\S]*resolution_source = 'manual'/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_business_object[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_actions[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_deadlines[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toMatch(/UPDATE public\.site_reserve[\s\S]*canonical_subject_id = p_target_canonical_subject_id/)
  })

  it('déplace les occurrences historiques sans réintroduire les sources supprimées', () => {
    expect(MIGRATION).toMatch(/JOIN public\.documents d[\s\S]*d\.deleted_at IS NULL/)
    expect(MIGRATION).toMatch(/UPDATE public\.canonical_subject_occurrence occ[\s\S]*SET canonical_subject_id = p_target_canonical_subject_id/)
    expect(MIGRATION).toContain('target_occ.id <> old_occ.id')
    expect(MIGRATION).toContain('canonicalSubjectOccurrenceMoved')
    expect(MIGRATION).toContain('canonicalSubjectOccurrenceDeduped')
  })

  it('n’introduit aucune création opportuniste de Point ou de Sujet', () => {
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.tracked_point\b/)
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.canonical_subject\b/)
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.canonical_business_object\b/)
  })

  it('expose une primitive TypeScript fine qui appelle la RPC transactionnelle', () => {
    expect(WRAPPER).toContain('curateTrackedPointSubject')
    expect(WRAPPER).toContain("rpc('curate_tracked_point_subject'")
    expect(WRAPPER).toContain('CurateTrackedPointSubjectResult')
    expect(WRAPPER).toContain('invalid_thread_identity')
  })
})
