// Tests ciblés du parseur structurel de routes /sites/* et /m/* (Thread C,
// FIX_REQUIRED GO Vincent 2026-09-22). Ne couvre QUE parseSiteOrMobileRoute —
// pas l'agrégation de friction ni la résolution batchée des libellés
// (couvertes par la recette réelle du commit e4e9ed80, non reconduite ici).

import { describe, it, expect } from 'vitest'
import { parseSiteOrMobileRoute } from '@/lib/db/user-journey'

const SITE_ID = '11111111-1111-1111-1111-111111111111'
const OBJ_ID = '22222222-2222-2222-2222-222222222222'

describe('parseSiteOrMobileRoute — mobile', () => {
  it('onglet chantier mobile par segment de route (jamais par query)', () => {
    expect(parseSiteOrMobileRoute(`/m/site/${SITE_ID}/points`)).toEqual({
      siteId: SITE_ID, viewKey: 'points', entityType: null, entityId: null, subKey: null,
    })
  })

  it('sous-page de visite mobile (compte rendu)', () => {
    expect(parseSiteOrMobileRoute(`/m/visite/${OBJ_ID}/cr`)).toEqual({
      siteId: null, viewKey: null, entityType: 'site_report', entityId: OBJ_ID, subKey: 'cr',
    })
  })
})

describe('parseSiteOrMobileRoute — desktop, routes dédiées', () => {
  it('vue liste à route dédiée (Suivi/historique) — prioritaire sur la racine générique', () => {
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}/historique`)).toEqual({
      siteId: SITE_ID, viewKey: 'historique', entityType: null, entityId: null, subKey: null,
    })
  })

  it('fiche d’entité (Point) — priorité du motif spécifique sur le motif générique racine', () => {
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}/point/${OBJ_ID}`)).toEqual({
      siteId: SITE_ID, viewKey: null, entityType: 'tracked_point', entityId: OBJ_ID, subKey: null,
    })
  })

  it('objet non résolvable en base : le parseur extrait quand même l’id (jamais d’abandon de la ligne) — le repli de libellé vit dans resolveEntityLabels/legacyLabelForRoute, pas ici', () => {
    const bogusId = 'id-disparu-de-la-base'
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}/point/${bogusId}`)).toEqual({
      siteId: SITE_ID, viewKey: null, entityType: 'tracked_point', entityId: bogusId, subKey: null,
    })
  })
})

describe('parseSiteOrMobileRoute — racine du chantier et onglets ?tab= (FIX_REQUIRED)', () => {
  it('racine sans navTab (événement historique, avant le fix) → Aperçu', () => {
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}`)).toEqual({
      siteId: SITE_ID, viewKey: 'apercu', entityType: null, entityId: null, subKey: null,
    })
  })

  it('racine + navTab whitelisté connu (événement futur capturé par le fix) → le vrai onglet', () => {
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}`, 'intervenants')).toEqual({
      siteId: SITE_ID, viewKey: 'intervenants', entityType: null, entityId: null, subKey: null,
    })
  })

  it('racine + navTab inconnu/invalide → repli Aperçu (ne fait jamais confiance à une valeur non whitelistée)', () => {
    expect(parseSiteOrMobileRoute(`/sites/${SITE_ID}`, 'nawak')).toEqual({
      siteId: SITE_ID, viewKey: 'apercu', entityType: null, entityId: null, subKey: null,
    })
  })
})

describe('parseSiteOrMobileRoute — route non reconnue', () => {
  it('route hors module chantier → null (traitée ailleurs par legacyLabelForRoute)', () => {
    expect(parseSiteOrMobileRoute('/comprendre/guide')).toBeNull()
  })
})
