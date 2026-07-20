import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Fiche Réunion — premier objet du Lot 4 ───────────────────────────────────
// getSiteReunionFiche est server-only (DB) → invariants protégés par lecture de
// source, même pattern que decision-fiche.doctrine.
//
// Ce fichier ne teste PAS le rendu : il protège les règles qui ont coûté cher à
// établir et qu'une réécriture innocente casserait sans faire échouer autre chose.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const model = read('lib/knowledge/reunion-fiche.ts')
const body = read('app/(dashboard)/sites/[id]/views/reunion/ReunionFiche.tsx')
const decision = read('lib/knowledge/decision-fiche.ts')

describe('getSiteReunionFiche — factuel et fail-closed', () => {
  it('garde org fail-closed + scope chantier sur la réunion', () => {
    expect(model).toContain('getOrgId')
    expect(model).toMatch(/organization_id !== orgId/)
    expect(model).toMatch(/from\('site_reports'\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('UNE seule vague de lectures — la garde part avec elles, jamais devant', () => {
    // Ce qui se paie est le nombre de VAGUES séquentielles (mesuré au Lot 3).
    const waves = model.match(/await Promise\.all\(/g) ?? []
    expect(waves).toHaveLength(1)
    expect(model).toMatch(/Promise\.all\(\[\s*\n\s*getOrgId\(\)/)
  })

  it('les décisions restent scopées au chantier (garde IDOR explicite)', () => {
    expect(model).toContain('.filter((d) => d.siteId === siteId)')
  })

  it('les participants jsonb sont filtrés, jamais crus sur parole', () => {
    expect(model).toContain('function lireParticipants')
    expect(model).toMatch(/if \(!Array\.isArray\(raw\)\) return \[\]/)
  })
})

describe('Fiche Réunion — la grammaire, appliquée et non réinventée', () => {
  it('chapô : UNE décision → elle est nommée et ouvrable', () => {
    expect(body).toMatch(/label: 'Conduit à', title: seule\.titre, href: seule\.href/)
  })

  it('chapô : PLUSIEURS décisions → aucun élu, aucun compte', () => {
    // Précédent de la fiche Intervenant : une urgence momentanée n'est pas une
    // identité, et un compteur n'est pas un rôle.
    expect(body).toContain("label: 'Conduit à plusieurs décisions', title: null")
    expect(body).not.toMatch(/Conduit à \$\{[^}]*length/)
  })

  it('chapô : AUCUNE décision → pas de chapô, et le corps le dit', () => {
    // La branche par défaut du chapô est `null` : aucun repli inventé.
    expect(body).toMatch(/const chapo: Chapo \| null =[\s\S]*?:\s*null\n/)
    expect(body).toContain('Aucune décision enregistrée')
  })

  it('le maillon Décision du fil n’est cliquable que s’il est unique', () => {
    // Avec plusieurs décisions, choisir laquelle ouvrir serait inventer.
    expect(body).toContain("href: seule?.href ?? null")
  })

  it('l’espace de travail du compte-rendu est une SORTIE, pas la destination', () => {
    expect(body).toContain('Ouvrir le compte-rendu complet')
    expect(model).toMatch(/compteRenduHref: `\/meetings\/\$\{r\.id\}`/)
  })
})

describe('Dette du Lot 3 levée — remonter le fil ne sort plus du panneau', () => {
  it('la réunion source d’une décision a une adresse DANS le chantier', () => {
    expect(decision).toMatch(/href: `\/sites\/\$\{siteId\}\/reunion\/\$\{d\.reportId\}`/)
    expect(decision).not.toMatch(/meeting = \{[^}]*href: `\/meetings\//)
  })
})
