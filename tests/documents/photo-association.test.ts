// Lot photo-association — tripwires structurels (zéro DB, zéro flake).
//
// Invariants vérifiés :
//   1. Migration 265 déclare ADD PRIMARY KEY (proposal_id, evidence_id)
//   2. linkProposalEvidence utilise onConflict: 'proposal_id,evidence_id'
//   3. L'extracteur passe skipIfExists:true pour les candidats
//   4. confirmPhotoAssociationAction écrit 'illustrates'
//   5. dismissPhotoAssociationAction écrit 'dismissed'
//   6. revertIllustratesAction supprime 'illustrates' et réinsère 'candidate'
//   7. listCandidateLinksForRun filtre les paires dismissed
//   8. La fiche visite construit illustratesMap pour attacher les photos aux constatations
//   9. La galerie résiduelle utilise unlinkedPinnedSnapshots
//  10. getIllustratesLinksForRun expose proposal_label (label humain)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

describe('Test 1 — Migration 265 : PK binaire (proposal_id, evidence_id)', () => {
  it('déclare DROP CONSTRAINT pkey puis ADD PRIMARY KEY binaire', () => {
    const sql = read('supabase/migrations/265_photo_unique_constraint.sql')
    expect(/DROP\s+CONSTRAINT\s+document_proposal_evidence_pkey/i.test(sql)).toBe(true)
    expect(/ADD\s+PRIMARY\s+KEY\s*\(\s*proposal_id\s*,\s*evidence_id\s*\)/i.test(sql)).toBe(true)
  })

  it('supprime les candidats orphelins avant de changer la PK', () => {
    const sql = read('supabase/migrations/265_photo_unique_constraint.sql')
    // Le DELETE doit apparaître AVANT le DROP CONSTRAINT
    const deletePos = sql.search(/DELETE\s+FROM/i)
    const dropPos = sql.search(/DROP\s+CONSTRAINT/i)
    expect(deletePos).toBeGreaterThanOrEqual(0)
    expect(dropPos).toBeGreaterThan(deletePos)
  })
})

describe('Test 2 — linkProposalEvidence : upsert sur la PK binaire', () => {
  it('utilise onConflict: \'proposal_id,evidence_id\'', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function linkProposalEvidence'
    const start = src.indexOf(marker)
    expect(start, 'linkProposalEvidence introuvable').toBeGreaterThanOrEqual(0)
    const body = src.slice(start, start + 600)
    expect(/onConflict:\s*'proposal_id,evidence_id'/.test(body)).toBe(true)
  })

  it('expose skipIfExists qui pilote ignoreDuplicates', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function linkProposalEvidence'
    const start = src.indexOf(marker)
    const body = src.slice(start, start + 600)
    expect(/skipIfExists\??\s*:\s*boolean/.test(body)).toBe(true)
    expect(/ignoreDuplicates:\s*skipIfExists\s*\?\?\s*false/.test(body)).toBe(true)
  })
})

describe('Test 3 — Extracteur : candidats avec skipIfExists=true', () => {
  it('linkProposalEvidence appelé avec true comme dernier argument pour les candidats', () => {
    const src = read('lib/documents/extract-historical-pv.ts')
    // Chercher l'appel qui crée des candidats
    expect(/linkProposalEvidence\s*\(\s*proposalId\s*,\s*evidenceId\s*,\s*'candidate'\s*,\s*null\s*,\s*true\s*\)/.test(src)).toBe(true)
  })

  it('n\'utilise pas skipIfExists pour les autres relations (supports)', () => {
    const src = read('lib/documents/extract-historical-pv.ts')
    // La liaison 'supports' ne doit pas avoir le 5e argument true
    expect(/linkProposalEvidence\s*\(\s*proposalId\s*,\s*evidenceId\s*,\s*'supports'.*,\s*true\s*\)/.test(src)).toBe(false)
  })
})

describe('Test 4 — confirmPhotoAssociationAction : écrit \'illustrates\'', () => {
  it('appelle linkProposalEvidence avec \'illustrates\'', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function confirmPhotoAssociationAction'
    const start = src.indexOf(marker)
    expect(start, 'confirmPhotoAssociationAction introuvable').toBeGreaterThanOrEqual(0)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    expect(/linkProposalEvidence\s*\(\s*proposalId\s*,\s*evidenceId\s*,\s*'illustrates'\s*\)/.test(body)).toBe(true)
  })

  it('supprime le lien candidat avant de créer illustrates', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function confirmPhotoAssociationAction'
    const start = src.indexOf(marker)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    const deletePos = body.search(/\.delete\s*\(/)
    const illustratesPos = body.search(/'illustrates'/)
    expect(deletePos).toBeGreaterThanOrEqual(0)
    expect(illustratesPos).toBeGreaterThan(deletePos)
  })
})

describe('Test 5 — dismissPhotoAssociationAction : écrit \'dismissed\'', () => {
  it('appelle linkProposalEvidence avec \'dismissed\'', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function dismissPhotoAssociationAction'
    const start = src.indexOf(marker)
    expect(start, 'dismissPhotoAssociationAction introuvable').toBeGreaterThanOrEqual(0)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    expect(/linkProposalEvidence\s*\(\s*proposalId\s*,\s*evidenceId\s*,\s*'dismissed'\s*\)/.test(body)).toBe(true)
  })

  it('la suppression cible uniquement le lien \'candidate\' — pas la paire entière', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function dismissPhotoAssociationAction'
    const start = src.indexOf(marker)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    // Le .delete() doit être suivi d'un filtre sur 'candidate' (pas suppression physique de la paire)
    expect(/\.delete\s*\(\s*\)[\s\S]*?\.eq\s*\([^)]*'candidate'/.test(body)).toBe(true)
  })
})

describe('Test 6 — revertIllustratesAction : illustrates → candidate', () => {
  it('supprime le lien \'illustrates\' puis crée \'candidate\'', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function revertIllustratesAction'
    const start = src.indexOf(marker)
    expect(start, 'revertIllustratesAction introuvable').toBeGreaterThanOrEqual(0)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    // Supprime 'illustrates'
    expect(/'illustrates'/.test(body)).toBe(true)
    expect(/\.delete\s*\(\s*\)/.test(body)).toBe(true)
    // Réinsère 'candidate'
    expect(/linkProposalEvidence\s*\(\s*proposalId\s*,\s*evidenceId\s*,\s*'candidate'\s*\)/.test(body)).toBe(true)
  })

  it('la suppression cible la relation_type \'illustrates\', pas toute la paire', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    const marker = 'export async function revertIllustratesAction'
    const start = src.indexOf(marker)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 800)
    expect(/\.eq\s*\([^)]*'illustrates'/.test(body)).toBe(true)
  })
})

describe('Test 7 — listCandidateLinksForRun : filtre les dismissed', () => {
  it('charge candidates ET dismissed en une requête', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function listCandidateLinksForRun'
    const start = src.indexOf(marker)
    expect(start, 'listCandidateLinksForRun introuvable').toBeGreaterThanOrEqual(0)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 1500)
    expect(/'candidate'/.test(body)).toBe(true)
    expect(/'dismissed'/.test(body)).toBe(true)
  })

  it('construit dismissedKeys et exclut les candidats dismissés', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function listCandidateLinksForRun'
    const start = src.indexOf(marker)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 1500)
    expect(/dismissedKeys/.test(body)).toBe(true)
    expect(/!dismissedKeys\.has/.test(body)).toBe(true)
  })
})

describe('Test 8 — Fiche visite : illustratesMap attache les photos aux constatations', () => {
  it('construit illustratesMap depuis getIllustratesLinksForRun', () => {
    const src = read('app/(dashboard)/sites/[id]/visites/[visitId]/page.tsx')
    expect(/illustratesMap/.test(src)).toBe(true)
    expect(/getIllustratesLinksForRun/.test(src)).toBe(true)
    expect(/illustratesMap\.get\s*\(\s*p\.id\s*\)/.test(src)).toBe(true)
  })

  it('les photos sont embarquées dans ChronologieItem.photos', () => {
    const src = read('app/(dashboard)/sites/[id]/visites/[visitId]/page.tsx')
    // Le type ChronologieItem doit contenir photos
    expect(/ChronologieItem.*photos\s*:/.test(src) || /photos\s*:\s*Array/.test(src)).toBe(true)
    // Le rendu itère item.photos
    expect(/item\.photos/.test(src)).toBe(true)
  })
})

describe('Test 9 — Galerie résiduelle : unlinkedPinnedSnapshots exclut les photos déjà illustrées', () => {
  it('déclare illustratedSnapshotIds à partir des liens illustrates', () => {
    const src = read('app/(dashboard)/sites/[id]/visites/[visitId]/page.tsx')
    expect(/illustratedSnapshotIds\s*=\s*new\s+Set/.test(src)).toBe(true)
    expect(/illustratesLinks\.map\s*\(.*evidence_id/.test(src)).toBe(true)
  })

  it('unlinkedPinnedSnapshots filtre les ids déjà illustrés', () => {
    const src = read('app/(dashboard)/sites/[id]/visites/[visitId]/page.tsx')
    expect(/unlinkedPinnedSnapshots\s*=\s*pinnedSnapshots\.filter/.test(src)).toBe(true)
    expect(/!illustratedSnapshotIds\.has/.test(src)).toBe(true)
    // La galerie utilise unlinkedPinnedSnapshots, pas pinnedSnapshots directement
    expect(/unlinkedPinnedSnapshots\.map/.test(src)).toBe(true)
  })
})

describe('Test 10 — getIllustratesLinksForRun : expose proposal_label', () => {
  it('retourne proposal_label dans son type de retour', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function getIllustratesLinksForRun'
    const start = src.indexOf(marker)
    expect(start, 'getIllustratesLinksForRun introuvable').toBeGreaterThanOrEqual(0)
    const next = src.indexOf('\nexport async function ', start + 1)
    const body = src.slice(start, next > start ? next : start + 1200)
    expect(/proposal_label\s*:\s*string\s*\|\s*null/.test(body)).toBe(true)
  })

  it('utilise reviewed_label ?? label pour le libellé humain', () => {
    const src = read('lib/db/document-extractions.ts')
    const marker = 'export async function getIllustratesLinksForRun'
    const start = src.indexOf(marker)
    // Lire jusqu'à la fin du fichier (dernière fonction)
    const body = src.slice(start)
    // La priorité reviewed_label > label est le contrat du libellé humain
    expect(/reviewed_label.*\?\?.*label/.test(body)).toBe(true)
  })
})
