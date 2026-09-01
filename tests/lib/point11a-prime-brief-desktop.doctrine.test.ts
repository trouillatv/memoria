// Point 11A' — sélectivité des listes du Brief DESKTOP (réduction de densité SEULE,
// grammaire intacte). « À traiter » / « À surveiller » : top 5 + total dans le titre
// + « Voir les N autres » qui MÈNE à la surface métier (jamais un dépli des N dans
// le Brief). Aucun retri, aucune modif mobile, « Traité récemment » inchangé.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/SiteBriefButton.tsx'), 'utf8')

/** Corps de LiveDebriefBlock (de sa déclaration à la fonction suivante). */
function liveDebriefBlockBody(): string {
  const start = SRC.indexOf('function LiveDebriefBlock(')
  const next = SRC.indexOf('\nfunction BriefBody(', start)
  return SRC.slice(start, next === -1 ? undefined : next)
}

describe('LiveDebriefBlock — dépassement = lien vers la surface, pas un dépli', () => {
  const body = liveDebriefBlockBody()

  it('accepte un overflowHref et rend un LIEN « Voir les N autres » quand il est fourni', () => {
    expect(body).toContain('overflowHref')
    expect(body).toMatch(/capped && overflowHref/)
    expect(body).toContain('<a href={overflowHref}')
    expect(body).toContain('Voir les {overflowCount} autre')
  })

  it('le lien de dépassement ne DÉPLIE pas la liste (setExpanded réservé au cas sans overflowHref)', () => {
    // La branche lien ne doit pas appeler setExpanded ; l'expansion locale reste
    // réservée à « Traité récemment » (capped && !overflowHref).
    const linkBranch = body.slice(body.indexOf('capped && overflowHref'), body.indexOf('capped && !overflowHref'))
    expect(linkBranch).not.toContain('setExpanded')
    expect(body).toMatch(/capped && !overflowHref/)
  })

  it('aucun retri dans le bloc — l’ordre vient de LiveDebrief (slice seulement)', () => {
    expect(body).not.toContain('.sort(')
    expect(body).toContain('items.slice(0, initialLimit)')
  })

  it('le titre porte le total (count = items.length) → « À traiter (89) »', () => {
    expect(body).toContain('count={items.length}')
  })
})

describe('Brief desktop — À traiter / À surveiller plafonnés à 5, DESKTOP uniquement', () => {
  it('À traiter : plafond 5 gaté desktop + lien vers /actions', () => {
    expect(SRC).toMatch(/title="À traiter"[\s\S]*?initialLimit=\{variant === 'desktop' \? 5 : undefined\}/)
    expect(SRC).toMatch(/title="À traiter"[\s\S]*?overflowHref=\{variant === 'desktop' \? `\/sites\/\$\{siteId\}\/actions`/)
  })

  it('À surveiller : plafond 5 gaté desktop + lien vers /historique (Suivi)', () => {
    expect(SRC).toMatch(/title="À surveiller"[\s\S]*?initialLimit=\{variant === 'desktop' \? 5 : undefined\}/)
    expect(SRC).toMatch(/title="À surveiller"[\s\S]*?overflowHref=\{variant === 'desktop' \? `\/sites\/\$\{siteId\}\/historique`/)
  })

  it('aucune modification mobile : hors desktop, initialLimit/overflowHref restent undefined', () => {
    // Le gate variant garantit que le variant mobile garde le comportement historique.
    expect(SRC).toContain("variant === 'desktop' ? 5 : undefined")
  })

  it('« Traité récemment » inchangé : dépli local (initialLimit=3, pas d’overflowHref)', () => {
    const recent = SRC.slice(SRC.indexOf('title="Traité récemment"'), SRC.indexOf('title="Traité récemment"') + 400)
    expect(recent).toContain('initialLimit={3}')
    expect(recent).not.toContain('overflowHref')
  })
})
