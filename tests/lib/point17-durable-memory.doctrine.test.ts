import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Point 17A — projection « mémoire durable » : read-model + UI. Lecture de source
// (server components). Aucune migration, aucune modification de la donnée stockée.

const review = readFileSync(join(process.cwd(), 'lib/knowledge/memory-review.ts'), 'utf8')
const entries = readFileSync(join(process.cwd(), 'lib/db/site-memory-entries.ts'), 'utf8')
const ui = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/views/memoire/MemoireConfirmer.tsx'), 'utf8')

describe('Point 17A — read-model : durabilité par thematic_category, sans toucher la donnée', () => {
  it('la durabilité vient du classifieur déterministe isDurableTheme(thematicCategory)', () => {
    expect(review).toContain('isDurableTheme')
    expect(review).toMatch(/durable: isDurableTheme\(e\.thematicCategory\)/)
  })

  it('les familles non-knowledge (intervenants/décisions/vigilances) restent durables', () => {
    expect(review).toMatch(/durable: true, thematicCategory: null, sourceCount: 0/)
  })

  it('provenance « N sources » construite depuis les colonnes existantes, jamais inventée', () => {
    expect(entries).toContain('source_capture_ids')
    expect(entries).toContain('thematic_category')
    expect(review).toMatch(/sourceCount: new Set\(\[\.\.\.\(e\.sourceReportId/)
  })

  it('aucune écriture, aucune migration : lecture seule (status reste décidé par la base)', () => {
    // on ne modifie jamais le status ici (pas d'update de knowledge_entries dans le read-model)
    expect(review).not.toMatch(/\.update\(|\.eq\('status'/)
  })
})

describe('Point 17A — UI : deux niveaux, rien de perdu, gestes préservés', () => {
  it('lecture principale = mémoire durable ; l’activité est un second niveau replié', () => {
    expect(ui).toMatch(/const durable = review\.confirmed\.filter\(\(c\) => c\.durable\)/)
    expect(ui).toMatch(/const activity = review\.confirmed\.filter\(\(c\) => !c\.durable\)/)
    // second niveau accessible, jamais supprimé
    expect(ui).toContain('Voir toute l’activité consignée')
    expect(ui).toContain('hors de la mémoire durable')
  })

  it('promesse « ce que MemorIA sait durablement », pas de KPI de comptage', () => {
    expect(ui).toContain('Ce que MemorIA sait durablement sur ce chantier.')
    // pas de dashboard « 12 connaissances · 4 personnes · … »
    expect(ui).not.toMatch(/\d+\s*connaissances?\s*·\s*\d+\s*personnes?/)
  })

  it('plafond d’affichage (CAP) : pas 381 cartes d’emblée ; le reste derrière un <details>', () => {
    expect(ui).toMatch(/const CAP = \d+/)
    expect(ui).toContain('CappedList')
    expect(ui).toMatch(/items\.slice\(0, CAP\)/)
    expect(ui).toMatch(/items\.slice\(CAP\)/)
  })

  it('le geste « Marquer comme obsolète » survit à la compaction (rendu sur chaque item, y compris repliés)', () => {
    // ArchiveKnowledgeEntryButton est dans ConfirmedRow, utilisé par CappedList (head + reste)
    expect(ui).toMatch(/function ConfirmedRow[\s\S]*?ArchiveKnowledgeEntryButton/)
    expect(ui).toContain('WhyButton')
  })
})
