// Phase 2 documents — garde-fous (spec 2026-05-19, exigés par Vincent).
//
// Tests STRUCTURELS purs (zéro base Cloud → zéro flake). Tripwires : ils
// passent sur le code conforme et FAIL si une régression viole un invariant.
//
//   1. un document ne peut pas être `ready` sans collection_id ;
//   2. tout chunk document a `source_domain='document'` ;
//   3. aucun module génératif/orchestrator importé dans le pipeline document.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

describe('Garde-fou #1 — pas de document `ready` sans collection_id', () => {
  it('migration 073 déclare documents.collection_id NOT NULL (FK)', () => {
    const sql = read('supabase/migrations/073_documents_generic.sql')
    // La colonne collection_id doit être NOT NULL et référencer les collections.
    expect(
      /collection_id\s+uuid\s+not\s+null\s+references\s+public\.document_collections/i.test(sql),
      'collection_id doit être NOT NULL references document_collections',
    ).toBe(true)
  })

  it('createDocument exige collection_id (type non optionnel)', () => {
    const src = read('lib/db/documents.ts')
    const m = src.match(/export async function createDocument\(input:\s*\{([\s\S]*?)\}\s*\)/)
    expect(m, 'signature createDocument introuvable').toBeTruthy()
    // `collection_id: string` sans `?` → obligatoire.
    expect(/collection_id\s*:\s*string\b/.test(m![1])).toBe(true)
    expect(/collection_id\s*\?\s*:/.test(m![1])).toBe(false)
  })

  it('le Server Action valide collection_id en uuid obligatoire', () => {
    const src = read('app/(dashboard)/documents/actions.ts')
    expect(/collection_id:\s*z\.string\(\)\.uuid\(/.test(src)).toBe(true)
  })
})

describe('Garde-fou #2 — chunk document → source_domain=document', () => {
  it('embedDocumentChunks upsert avec source_domain:\'document\' et aucun autre', () => {
    const src = read('lib/ai/embed-knowledge-chunks.ts')
    // Extraction ROBUSTE : de la signature jusqu'au prochain `export` top-level
    // (ou fin de fichier). L'ancienne regex `[\s\S]*?\n}\n` s'arrêtait au 1er
    // `\n}\n` et tronquait le corps dès qu'une closure interne existait
    // (cas depuis la parallélisation de embedDocumentChunks).
    const marker = 'export async function embedDocumentChunks'
    const start = src.indexOf(marker)
    expect(start, 'embedDocumentChunks introuvable').toBeGreaterThanOrEqual(0)
    const after = src.slice(start + marker.length)
    const nextExport = after.indexOf('\nexport ')
    const body = nextExport >= 0 ? after.slice(0, nextExport) : after
    expect(/source_domain:\s*'document'/.test(body)).toBe(true)
    // Aucun autre source_domain littéral écrit dans cette fonction.
    const others = body.match(/source_domain:\s*'(?!document')[a-z_]+'/g)
    expect(others, `source_domain étranger: ${others}`).toBeNull()
    // delete cible bien le domaine document.
    expect(/source_domain',\s*'document'\)|eq\('source_domain',\s*'document'\)/.test(body)).toBe(true)
  })
})

describe('Garde-fou #3 — pipeline document sans génération LLM', () => {
  const FORBIDDEN =
    /from\s+['"]@?\/?(?:.*\/)?(services\/ai\/orchestrator|services\/ai\/initial-analysis|services\/ai\/engagement-extraction|services\/ai\/chat|services\/ai\/agents|services\/ai\/library-context)['"]|@anthropic-ai|@google\/genai['"]|\bgenerateText\b|\banalyzeTender\b|\bbuildLibraryContext\b/

  for (const f of ['lib/documents/analyze.ts', 'app/(dashboard)/documents/actions.ts']) {
    it(`${f} n'importe aucun module génératif/orchestrator`, () => {
      const code = read(f)
        .split('\n')
        .filter((l) => {
          const t = l.trim()
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')
      expect(FORBIDDEN.test(code), `import génératif interdit dans ${f}`).toBe(false)
    })
  }

  it('analyzeDocument n\'importe que extract + embeddings + db documents', () => {
    const src = read('lib/documents/analyze.ts')
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    // Pas d'import IA générative ; seulement extraction/embeddings/db/supabase.
    const allowed = /^(server-only|@\/lib\/supabase\/admin|@\/services\/pdf\/extract|@\/lib\/ai\/embed-knowledge-chunks|@\/lib\/db\/documents)$/
    const stray = imports.filter((i) => !allowed.test(i))
    expect(stray, `imports inattendus: ${stray}`).toEqual([])
  })
})

describe('Discipline coût IA — analyse async, jamais au render', () => {
  it('uploadDocumentAction planifie analyzeDocument via after() (fire-and-forget)', () => {
    const src = read('app/(dashboard)/documents/actions.ts')
    expect(/after\(\(\)\s*=>\s*analyzeDocument\(/.test(src)).toBe(true)
  })
})
