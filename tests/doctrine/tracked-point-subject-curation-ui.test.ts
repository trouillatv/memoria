import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('Point subject curation UI', () => {
  const action = read('app/(dashboard)/sites/[id]/tracked-point-subject-curation-actions.ts')
  const control = read('components/knowledge/PointSubjectCurationControl.tsx')
  const pointView = read('components/knowledge/PointFicheView.tsx')
  const pointPage = read('app/(dashboard)/sites/[id]/point/[pointId]/page.tsx')
  const canonicalSubjectLife = read('lib/db/canonical-subject-life.ts')

  it('routes every mutation through the durable backend primitive', () => {
    expect(action).toContain("'use server'")
    expect(action).toContain('requireSiteWriteAccess(siteId, \'managerOrAdmin\')')
    expect(action).toContain('curateTrackedPointSubject({')
    expect(action).toContain('revalidatePath(`/sites/${siteId}/point/${trackedPointId}`)')
    expect(action).not.toMatch(/\.from\(['"`]tracked_point['"`]\)/)
    expect(action).not.toMatch(/\.from\(['"`]subject_thread_identity['"`]\)/)
  })

  it('exposes only the change-subject gesture in the Point fiche', () => {
    expect(pointPage).toContain('listSubjectsForPicker')
    expect(pointPage).toContain('getTrackedPointSubjectCurationState')
    expect(pointPage).toContain('subjectCuration={{ subjects: subjectPickerItems, isManual: subjectCurationState.isManual }}')
    expect(pointView).toContain('PointSubjectCurationControl')
    expect(control).toContain('Changer de sujet')
    expect(control).toContain('Sujet défini manuellement')
    expect(control).toContain('Motif facultatif')
    expect(control).not.toContain('Créer un sujet')
    expect(control).not.toContain('createCanonicalSubject')
  })

  it('does not offer the current subject as a target', () => {
    expect(control).toContain("subjects.filter((s) => s.status === 'active' && s.id !== currentSubjectId)")
  })

  it('uses the same business-subject picker population for attached and subjectless Points', () => {
    expect(pointPage).toContain('return listSubjectsForPicker(siteId, currentCanonicalSubjectId)')
    expect(pointPage).not.toContain('listActiveCanonicalSubjects')
    expect(canonicalSubjectLife).toContain("select('id, label, aliases, status, kind')")
    expect(canonicalSubjectLife).toContain('.filter((cs) => isOperationalSubject(cs.kind))')
  })
})
