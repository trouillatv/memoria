// P0 — DELETED HISTORICAL SOURCE (2026-09-17).
//
// Sentinelles de couverture : les consommateurs qui transforment une proposition
// ou un run historique en CBO / Point / complétion doivent déléguer à la primitive
// partagée `historical-source-eligibility`.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('deleted historical source consumers', () => {
  it('le resolver de complétion exclut les propositions issues de documents supprimés', () => {
    const source = read('lib/knowledge/document-completion-resolver.ts')
    expect(source).toMatch(/getDeletedDocumentIds/)
    expect(source).toMatch(/eligibleProps = props\.filter\(\(p\) => !p\.document_id \|\| !deletedDocIds\.has\(p\.document_id\)\)/)
    expect(source).toMatch(/return eligibleProps\.map/)
  })

  it('le Live Writer historique refuse le run supprimé et filtre l historique des threads', () => {
    const source = read('lib/db/tracked-point-live-writer-historical-adapter.ts')
    expect(source).toMatch(/isExtractionRunSourceDeleted\(db, runId\)/)
    expect(source).toMatch(/const props = allProps\.filter\(\(p\) => !p\.document_id \|\| !deletedDocIds\.has\(p\.document_id\)\)/)
    expect(source).toMatch(/const eligibleMemberProps = memberProps\.filter/)
  })

  it('les read-models Point neutralisent les documents supprimés via la primitive commune', () => {
    const siteWide = read('lib/knowledge/tracked-point-read-model.ts')
    const mini = read('lib/knowledge/tracked-point-subject-context.ts')
    expect(siteWide).toMatch(/getDeletedDocumentIds\(supabase, docIds\)/)
    expect(siteWide).toMatch(/!deletedDocIds\.has\(d\.id\)/)
    expect(mini).toMatch(/getDeletedDocumentIds\(supabase, docIds\)/)
    expect(mini).toMatch(/!deletedDocIds\.has\(d\.id\)/)
  })

  it('la chaîne CBO historique exclut propositions et rapports supprimés', () => {
    const resolve = read('lib/db/canonical-business-object-resolve.ts')
    const attach = read('lib/db/canonical-business-object-attach.ts')
    expect(resolve).toMatch(/getDeletedDocumentIds\(sb, proposalRows\.map\(\(p\) => p\.document_id\)\)/)
    expect(resolve).toMatch(/eligibleProposals = proposalRows\.filter/)
    expect(attach).toMatch(/isSourceDocumentDeleted\(sb, proposal\.document_id\)/)
    expect(attach).toMatch(/isSourceDocumentDeleted\(sb, report\?\.source_document_id\)/)
  })
})
