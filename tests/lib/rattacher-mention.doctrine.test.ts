import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── RATTACHER UNE MENTION À UNE IDENTITÉ CONNUE (Vincent, 2026-07-22) ────────
//
// « À identifier » n'offrait que deux issues — nouvel intervenant, ou masquer —
// et poussait donc mécaniquement au doublon. Le troisième geste manquait :
// rattacher. Ces tests tiennent les quatre règles qui le rendent sûr.

const dir = join(process.cwd(), 'app/(dashboard)/sites/[id]/views/intervenants')
const card = readFileSync(join(dir, 'IdentifyCard.tsx'), 'utf8')
const actions = readFileSync(join(dir, 'intervenants-actions.ts'), 'utf8')
const promotion = readFileSync(join(process.cwd(), 'lib/db/knowledge-proposals.ts'), 'utf8')
/** Ce que la carte PROPOSE, commentaires retirés : les en-têtes expliquent
 *  justement pourquoi on ne fusionne pas, et ces phrases ne doivent pas faire
 *  échouer la règle qu'elles décrivent. */
const rendu = card.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')

describe('trois gestes par mention détectée, pas deux', () => {
  it.each(['Nouvel intervenant', 'Rattacher', 'Écarter'])('« %s » est proposé', (geste) => {
    expect(card).toContain(geste)
  })

  it('on rattache, on ne FUSIONNE pas — deux fiches ne sont jamais fondues', () => {
    expect(rendu).not.toMatch(/Fusionner/i)
  })
})

describe('rattacher vise une identité, jamais un libellé', () => {
  it('la promotion transmet company_id — le nom affiché créerait le doublon', () => {
    // La recherche affiche `short_name || name` ; findOrCreateCompanyByName
    // compare sur `name`. Renvoyer le libellé aurait créé « Clim Expert » à
    // côté de « Clim'Expert SARL ».
    expect(card).toMatch(/company_id: cible\.companyId/)
    expect(promotion).toMatch(/const companyId = params\.input\?\.companyId\s*\n?\s*\?\?/)
  })

  it('une entreprise citée ne devient pas un contact à son nom', () => {
    expect(card).toMatch(/contact_id: cible\.kind === 'contact' \? cible\.contactId : null/)
  })
})

describe('la mention d’origine survit au rattachement', () => {
  it('la promotion ne réécrit jamais le titre de la proposition', () => {
    // C'est `title` qui permettra de dire « “Clim Expert” a été cité, et
    // rattaché à Clim'Expert SARL ». Le renommer perdrait la preuve.
    const maj = promotion.slice(promotion.indexOf("status: 'confirmed'"))
    expect(maj.slice(0, 400)).not.toMatch(/\btitle:/)
  })

  it('le journal garde les cinq informations du geste', () => {
    const maj = promotion.slice(promotion.indexOf("status: 'confirmed'"), promotion.indexOf("status: 'confirmed'") + 400)
    // identité cible, auteur, date — la mention et la visite source vivent déjà
    // sur la ligne (`title`, `report_id`) et ne sont pas touchées.
    expect(maj).toContain('promoted_object_id')
    expect(maj).toContain('reviewed_by')
    expect(maj).toContain('reviewed_at')
  })
})

describe('la recherche rend les deux natures, et situe chaque résultat', () => {
  it('cherche les entreprises ET les contacts', () => {
    expect(actions).toContain("kind: 'company' as const")
    expect(actions).toContain("kind: 'contact' as const")
  })

  it('dit ce qui est déjà sur ce chantier, et sous quel rôle', () => {
    expect(actions).toContain('onThisSite')
    expect(actions).toContain('knownRole')
    // Le rôle en vigueur évite de reposer une question déjà tranchée.
    expect(card).toContain('cible.knownRole ?? role')
  })

  it('remonte d’abord ce qui est déjà au casting — la réponse la plus probable', () => {
    expect(actions).toMatch(/sort\(\(a, b\) => Number\(b\.onThisSite\) - Number\(a\.onThisSite\)\)/)
  })
})
