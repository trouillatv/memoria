// Tripwire doctrinal : l'audit documentaire ne traite JAMAIS source_ref.page
// comme l'autorité de navigation ou de sélection de source.
//
// « Une page inventée est pire que pas de page. » La source affichée et
// ouverte vient du read model de provenance persisté (tender_document_id,
// page_number, state) — jamais reconstruite depuis source_ref, la similarité
// de nom de fichier, l'ordre des pièces ou le niveau de citation heuristique.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const AUDIT = 'app/(dashboard)/tenders/[id]/audit'
const page = read(`${AUDIT}/page.tsx`)
const audit = read(`${AUDIT}/DocumentAudit.tsx`)
const contract = read(`${AUDIT}/audit-provenance.ts`)

// Retire les lignes de commentaire pour ne garder que le code exécuté : les
// commentaires PEUVENT nommer source_ref (pour dire qu'on ne l'utilise pas).
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

describe('Audit — la provenance vient du read model, pas de source_ref.page', () => {
  it('la page charge le read model de provenance (listTenderEngagementProvenance)', () => {
    expect(/listTenderEngagementProvenance\(/.test(page)).toBe(true)
    expect(/listTenderDocuments\(/.test(page)).toBe(true)
  })

  it('la page ne lit JAMAIS source_ref.page comme source (aucun accès .page sur source_ref)', () => {
    const code = codeOnly(page)
    // Aucun accès source_ref pour la navigation dans le code exécuté.
    expect(/source_ref/.test(code)).toBe(false)
    // Ni la variable héritée `ref.page` qui promouvait une page devinée.
    expect(/ref\.page/.test(code)).toBe(false)
  })

  it("l'audit ne dérive plus la navigation du niveau de citation heuristique", () => {
    // citationLevel(page, section) était l'ancienne autorité UI ; la navigation
    // passe désormais par l'état de provenance persisté.
    expect(/citationLevel/.test(codeOnly(audit))).toBe(false)
    expect(/from '@\/lib\/engagements\/citation'/.test(audit)).toBe(false)
  })

  it("l'audit navigue par état de provenance (applyProvenanceSelection)", () => {
    expect(/applyProvenanceSelection/.test(audit)).toBe(true)
    // Le contrat distingue explicitement les états localisables ; l'état
    // non localisé (unavailable) est le repli sûr qui laisse le lecteur en place.
    expect(/'exact'/.test(contract)).toBe(true)
    expect(/'document_only'/.test(contract)).toBe(true)
    // L'UI nomme unavailable pour afficher « Source non localisée ».
    expect(/'unavailable'/.test(audit)).toBe(true)
  })

  it('unavailable ne choisit AUCUNE pièce de repli (le lecteur ne bouge pas)', () => {
    // Le contrat retourne la sélection courante inchangée pour unavailable :
    // aucun repli par récence, ordre ou nom.
    const code = codeOnly(contract)
    expect(/return current/.test(code)).toBe(true)
    // Et surtout : pas de tri/sélection par nom de fichier ou récence.
    expect(/sort\(.*filename|recency|uploaded_at/i.test(code)).toBe(false)
  })

  it('le contrat de navigation ne lit jamais source_ref', () => {
    expect(/source_ref/.test(codeOnly(contract))).toBe(false)
  })
})
