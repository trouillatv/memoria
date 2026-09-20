import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('Point and Subject curation UI', () => {
  const pointAction = read('app/(dashboard)/sites/[id]/tracked-point-subject-curation-actions.ts')
  const subjectAction = read('app/(dashboard)/sites/[id]/historique/sujets/[canonicalSubjectId]/subject-curation-actions.ts')
  const pointControl = read('components/knowledge/PointSubjectCurationControl.tsx')
  const subjectControl = read('app/(dashboard)/sites/[id]/historique/sujets/[canonicalSubjectId]/SubjectCurationControls.tsx')
  const pointView = read('components/knowledge/PointFicheView.tsx')
  const pointPage = read('app/(dashboard)/sites/[id]/point/[pointId]/page.tsx')
  const subjectPage = read('app/(dashboard)/sites/[id]/historique/sujets/[canonicalSubjectId]/page.tsx')
  const canonicalSubjectLife = read('lib/db/canonical-subject-life.ts')

  it('routes Point mutations through durable server primitives', () => {
    expect(pointAction).toContain("'use server'")
    expect(pointAction).toContain("requireSiteWriteAccess(siteId, 'managerOrAdmin')")
    expect(pointAction).toContain('curateTrackedPointSubject({')
    expect(pointAction).toContain('createSubjectFromTrackedPoint({')
    expect(pointAction).not.toMatch(/\.from\(['"`]tracked_point['"`]\)/)
    expect(pointAction).not.toMatch(/\.from\(['"`]subject_thread_identity['"`]\)/)
  })

  it('routes Subject rename and merge through durable server primitives', () => {
    expect(subjectAction).toContain("'use server'")
    expect(subjectAction).toContain("requireSiteWriteAccess(parsed.data.siteId, 'managerOrAdmin')")
    expect(subjectAction).toContain('renameCanonicalSubjectManual({')
    expect(subjectAction).toContain('mergeCanonicalSubjectsManual({')
    expect(subjectAction).not.toMatch(/\.from\(['"`]canonical_subject['"`]\)/)
  })

  it('exposes move, create and manual detach on the Point fiche', () => {
    expect(pointPage).toContain('listSubjectsForPicker')
    expect(pointPage).toContain('getTrackedPointSubjectCurationState')
    expect(pointPage).toContain('curationKind: subjectCurationState.curationKind')
    expect(pointView).toContain('PointSubjectCurationControl')
    expect(pointControl).toContain('Changer de sujet')
    expect(pointControl).toContain('Creer un nouveau sujet')
    expect(pointControl).toContain('Mettre sans sujet')
    expect(pointControl).toContain('Sans sujet - decision manuelle')
    expect(pointControl).toContain('Motif facultatif')
  })

  it('exposes rename and merge on the canonical Subject fiche', () => {
    expect(subjectPage).toContain('SubjectCurationControls')
    expect(subjectControl).toContain('Renommer')
    expect(subjectControl).toContain('Fusionner avec')
    expect(subjectControl).toContain('sourceCanonicalSubjectId: subjectId')
    expect(subjectControl).toContain('targetCanonicalSubjectId: selected.id')
  })

  it('does not offer the current subject as a target', () => {
    expect(pointControl).toContain("s.id !== currentSubjectId")
    expect(subjectControl).toContain("s.id !== subjectId")
  })

  it('uses the same business-subject picker population for attached and subjectless Points', () => {
    expect(pointPage).toContain('return listSubjectsForPicker(siteId, currentCanonicalSubjectId)')
    expect(pointPage).not.toContain('listActiveCanonicalSubjects')
    expect(canonicalSubjectLife).toContain("select('id, label, aliases, status, kind')")
    expect(canonicalSubjectLife).toContain('.filter((cs) => isOperationalSubject(cs.kind))')
  })
})
