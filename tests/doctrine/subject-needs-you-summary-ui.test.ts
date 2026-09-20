import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SUBJECT_PAGES = [
  'app/(dashboard)/sites/[id]/historique/sujets/[canonicalSubjectId]/page.tsx',
  'app/(field)/m/site/[siteId]/(chantier)/sujets/[canonicalSubjectId]/page.tsx',
]

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

describe('fiche Sujet — NeedsYou contextuel', () => {
  it('résume les questions sans répéter les libellés techniques de catégorie', () => {
    for (const page of SUBJECT_PAGES) {
      const src = readSource(page)
      expect(src).toContain('Certaines informations de ce sujet doivent encore être confirmées ou précisées.')
      expect(src).toContain('Examiner')
      expect(src).not.toContain('MEMORIA_NEEDS_YOU_CATEGORY_LABELS')
      expect(src).not.toContain('resolveMemoriaNeedsYouSubjectPointRef')
    }
  })
})
