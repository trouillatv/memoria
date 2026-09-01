// Point 11A — doctrine du Brief mobile : convergence sur LiveDebrief (même vérité
// que le desktop), retrait des blocs agrégats exhaustifs, « Mon plan » P1-A
// inchangé, non-régression temporelle 9+10.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PAGE = read('app/(field)/m/site/[siteId]/prepare/page.tsx')
const SPINE = read('app/(field)/m/site/[siteId]/prepare/PrepareReadSpine.tsx')
const DESKTOP = read('app/(dashboard)/sites/[id]/site-brief-actions.ts')

describe('Brief mobile — même vérité métier que le desktop (LiveDebrief)', () => {
  it('le Brief mobile lit buildLiveDebrief', () => {
    expect(PAGE).toContain('buildLiveDebrief')
  })
  it('le Brief desktop lit aussi buildLiveDebrief (vérité commune)', () => {
    expect(DESKTOP).toContain('buildLiveDebrief')
  })
})

describe('Brief mobile — retrait des blocs agrégats/exhaustifs', () => {
  it('plus de SiteStatusCard ni de buildSiteStatusSummary (compteurs d’état)', () => {
    expect(PAGE).not.toContain('SiteStatusCard')
    expect(PAGE).not.toContain('buildSiteStatusSummary')
  })
  it('plus de DeltaBlock ni de buildVisitBriefing (deltas en compteurs)', () => {
    expect(PAGE).not.toContain('DeltaBlock')
    expect(PAGE).not.toContain('buildVisitBriefing')
  })
})

describe('Brief mobile — « Mon plan » P1-A inchangé', () => {
  it('VisitBriefClient (source pvAttention/pvToVerify) toujours rendu', () => {
    expect(PAGE).toContain('VisitBriefClient')
    expect(PAGE).toContain('pvAttention')
    expect(PAGE).toContain('pvToVerify')
  })
  it('la colonne de lecture LiveDebrief ne branche PAS d’ajout au plan (aucun objet LiveDebrief dans addToPlan)', () => {
    // La lecture est en lecture seule : pas d'appel addToPlanAction, pas de fabrication
    // de stable_key pour les objets LiveDebrief (mécanique figée non touchée).
    expect(SPINE).not.toContain('addToPlan')
    expect(SPINE).not.toContain('stable_key')
    expect(SPINE).not.toContain('stableKey')
  })
})

describe('Brief mobile — Objectif via le sélecteur déterministe existant', () => {
  it('réutilise selectPreparationObjective (pas de nouvelle sélection)', () => {
    expect(PAGE).toContain('selectPreparationObjective')
  })
})

describe('Brief mobile — non-régression temporelle 9+10', () => {
  it('« Depuis la venue » conditionne le possessif à personal (jamais une venue fabriquée)', () => {
    expect(SPINE).toContain("sinceLastVisit.personal ? 'Depuis votre dernière venue' : 'Depuis la dernière visite'")
    expect(SPINE).toContain("sinceLastVisit.personal ? 'votre passage' : 'la dernière visite'")
  })
})

describe('Brief mobile — sobriété : plafonds explicites', () => {
  it('À traiter et À surveiller sont plafonnés (constantes de cap)', () => {
    expect(SPINE).toContain('TO_HANDLE_MAX = 5')
    expect(SPINE).toContain('TO_WATCH_MAX')
  })
  it('le dépassement passe par « Voir plus », jamais par un agrégat', () => {
    expect(SPINE).toContain('Voir plus')
  })
})
