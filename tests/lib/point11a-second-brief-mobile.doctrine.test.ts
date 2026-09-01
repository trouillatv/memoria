// Point 11A'' — réduction de densité MOBILE, conservatrice. Un seul delta dans le
// Brief (A = « Depuis votre dernière visite » / VisitBriefingBlock) ; le delta PV↔PV
// (B = DeltaBlock / overview.pvLastDelta) est retiré de CETTE surface uniquement.
// Échéances dépassées plafonnées à 5, ordre inchangé, sans lien inventé. Rien d'autre.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PAGE = read('app/(field)/m/site/[siteId]/prepare/page.tsx')
const OVERDUE = read('app/(field)/m/site/[siteId]/prepare/OverdueDeadlinesSection.tsx')

describe('Brief mobile 11A2 — un seul delta (A conservé, B retiré)', () => {
  it('A conservé : VisitBriefingBlock reste rendu (référentiel « ma dernière visite »)', () => {
    expect(PAGE).toContain('VisitBriefingBlock')
  })
  it('B retiré de la surface : plus de DeltaBlock ni de rendu de pvLastDelta', () => {
    expect(PAGE).not.toContain('DeltaBlock')
    expect(PAGE).not.toContain('pvLastDelta')
  })
  it('aucun fallback A→B : le delta PV n’est jamais rendu, même quand A est vide', () => {
    // B totalement absent de la page → aucun basculement silencieux de référentiel.
    expect(PAGE).not.toMatch(/DeltaBlock|overview\.pvLastDelta/)
  })
  it('« Mon plan » (P1-A) et le reste intacts : VisitBriefClient toujours rendu', () => {
    expect(PAGE).toContain('VisitBriefClient')
    expect(PAGE).toContain('pvAttention')
    expect(PAGE).toContain('pvToVerify')
  })
})

describe('Échéances dépassées 11A2 — plafond 5, ordre conservé, sans lien inventé', () => {
  it('plafond de 5, dans l’ordre existant (slice, aucun retri)', () => {
    expect(OVERDUE).toContain('const MAX = 5')
    expect(OVERDUE).toContain('overdue.slice(0, MAX)')
    expect(OVERDUE).not.toContain('.sort(')
  })
  it('le total reste au titre', () => {
    expect(OVERDUE).toContain('Échéances dépassées ({overdue.length})')
  })
  it('overflow = indicateur de compte, PAS un lien inventé (pas de surface échéances mobile)', () => {
    expect(OVERDUE).toContain('rest > 0')
    expect(OVERDUE).toMatch(/\+\{rest\} autre/)
    // Aucune route inventée pour le « voir plus »
    expect(OVERDUE).not.toContain('<a ')
    expect(OVERDUE).not.toContain('href')
    expect(OVERDUE).not.toContain('/m/planning')
  })
})
