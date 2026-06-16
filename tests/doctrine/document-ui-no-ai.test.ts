// Phase 4a — garde-fou : « on ne mélange pas UI documentaire et contexte IA »
// (consigne explicite Vincent). L'UI documentaire (collections, upload,
// listings, section contrat) NE DOIT importer aucun module IA/recall/
// génératif. buildDocumentContext / recall / injection agents = phase 4b.
//
// Tripwire structurel pur (zéro base → zéro flake).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const UI_FILES = [
  'app/(dashboard)/documents/page.tsx',
  'app/(dashboard)/documents/NewCollectionForm.tsx',
  // L'ancien UploadDocumentForm.tsx a été refondu : l'upload vit désormais dans
  // import/BatchImportForm.tsx ; la bibliothèque dans CollectionLibrary.tsx.
  'app/(dashboard)/documents/import/BatchImportForm.tsx',
  'app/(dashboard)/documents/CollectionLibrary.tsx',
  'app/(dashboard)/documents/DocumentRowActions.tsx',
  'lib/documents/labels.ts',
]

// Interdits dans l'UV phase 4a : tout ce qui touche IA / recall / contexte.
const FORBIDDEN =
  /services\/ai\/|@anthropic-ai|@google\/genai|\bembed-knowledge-chunks\b|@\/lib\/documents\/analyze\b|\bbuildDocumentContext\b|\bgenerateText\b|\brecall\b|find_similar_knowledge_chunks/

describe('Phase 4a — UI documentaire sans contexte IA', () => {
  for (const f of UI_FILES) {
    it(`${f} n'importe aucun module IA/recall/génératif`, () => {
      const code = read(f)
        .split('\n')
        .filter((l) => {
          const t = l.trim()
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')
      expect(FORBIDDEN.test(code), `import IA interdit (4a) dans ${f}`).toBe(false)
    })
  }

  it('la section Documents du contrat reste un consommateur mince (pas d\'IA)', () => {
    const src = read('app/(dashboard)/contracts/[id]/page.tsx')
    // La seule dépendance documentaire autorisée ici : lib/db/documents
    // (listDocumentsForTarget) + labels. Aucun module IA documentaire.
    expect(/@\/lib\/documents\/analyze|buildDocumentContext|embed-knowledge-chunks|services\/ai\/agents/.test(src)).toBe(false)
    expect(src.includes("listDocumentsForTarget('contract'")).toBe(true)
  })
})
