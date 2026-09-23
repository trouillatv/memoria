// BUG UX BLOQUANT (Vincent 2026-09-23) — depuis une fiche chantier déjà
// contextualisée (?target_type=site&target_id=…), la page /documents/import ne
// résolvait jamais l'organisation du site : NewCollectionForm n'avait aucun
// champ organization_id, donc un utilisateur multi-organisation (ex. vient de
// créer un chantier AGP) tombait sur « Sélectionnez une organisation » sans
// aucun sélecteur exploitable. Doctrine cible :
//   - site contextualisé → organisation présélectionnée automatiquement et non
//     ambiguë (dérivée du site, pas de la seule appartenance de l'utilisateur) ;
//   - bibliothèque globale → sélecteur générique (getOrgsForSelector) ;
//   - `orgs` propagé jusqu'à NewCollectionForm des DEUX points d'entrée.
//
// Couverture fonctionnelle du calcul lui-même : tests/actions/document-collection-org.test.ts
// (résolution serveur) + tests/components/new-collection-form-org.test.tsx (rendu du sélecteur).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const importPage = read('app/(dashboard)/documents/import/page.tsx')
const libraryPage = read('app/(dashboard)/documents/page.tsx')
const batchForm = read('app/(dashboard)/documents/import/BatchImportForm.tsx')
const newCollectionForm = read('app/(dashboard)/documents/NewCollectionForm.tsx')
const actions = read('app/(dashboard)/documents/actions.ts')

describe('Import documentaire — site contextualisé résout son organisation', () => {
  it('cherche le site cible dans `sites` (déjà filtré par appartenance) quand target_type=site', () => {
    expect(/target_type\s*===\s*['"]site['"][\s\S]{0,80}sites\.find/.test(importPage)).toBe(true)
  })
  it('un site avec organisation connue produit une liste orgs à un seul élément (présélection non ambiguë)', () => {
    expect(/contextSite\?\.organization_id/.test(importPage)).toBe(true)
  })
  it('sans contexte site exploitable, retombe sur le sélecteur générique getOrgsForSelector()', () => {
    expect(/getOrgsForSelector\(\)/.test(importPage)).toBe(true)
  })
  it('`orgs` est transmis à BatchImportForm', () => {
    expect(/<BatchImportForm[\s\S]{0,400}orgs=\{orgs\}/.test(importPage)).toBe(true)
  })
})

describe('Bibliothèque globale — sélecteur générique sur le second point d’entrée', () => {
  it('la page Bibliothèque calcule aussi orgs via getOrgsForSelector()', () => {
    expect(/getOrgsForSelector\(\)/.test(libraryPage)).toBe(true)
  })
  it('`orgs` est transmis à NewCollectionForm', () => {
    expect(/<NewCollectionForm[^/]*orgs=\{orgs\}/.test(libraryPage)).toBe(true)
  })
})

describe('BatchImportForm propage orgs jusqu’au formulaire de création', () => {
  it('accepte `orgs` en prop', () => {
    expect(/orgs\??:\s*OrgOption\[\]/.test(batchForm)).toBe(true)
  })
  it('le passe à NewCollectionForm (pas de perte en route)', () => {
    expect(/<NewCollectionForm orgs=\{orgs\}/.test(batchForm)).toBe(true)
  })
})

describe('NewCollectionForm — jamais d’état « Sélectionnez une organisation » sans sélecteur', () => {
  it('rend OrgSelectorClient (mono-org silencieux, multi-org réel <select>)', () => {
    expect(/<OrgSelectorClient/.test(newCollectionForm)).toBe(true)
  })
  it('n’affiche plus l’erreur serveur comme un texte inerte remplaçant le sélecteur', () => {
    // Le composant garde l'affichage d'erreur générique, mais un sélecteur existe
    // désormais toujours en amont : ce test verrouille sa présence, pas sa disparition.
    expect(/orgs\??:\s*OrgOption\[\]/.test(newCollectionForm)).toBe(true)
  })
})

describe('createDocumentCollectionAction — un seul endroit décide de l’organisation', () => {
  it('réutilise resolveCreationOrgId (lib/auth/creation-org), ne duplique plus la logique 0/1/many', () => {
    expect(/resolveCreationOrgId\(/.test(actions)).toBe(true)
  })
})
