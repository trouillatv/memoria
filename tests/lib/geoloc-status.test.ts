// Lot GPS — mapping d'erreur géoloc et libellés d'état, jamais silencieux.
//
// Garde de non-régression (Vincent) : GeolocationPositionError ne distingue de
// façon fiable que PERMISSION_DENIED des deux autres codes (Android/iOS/PWA) —
// « GPS désactivé » n'est PAS un état prouvable et ne doit JAMAIS apparaître.

import { describe, it, expect } from 'vitest'
import {
  mapGeolocationError,
  PANEL_LABEL,
  CAMERA_BANNER_LABEL,
  type GeoStatus,
} from '@/lib/field/geoloc-status'

const ALL_STATUSES: GeoStatus[] = [
  'idle', 'locating', 'success', 'user-disabled', 'permission-denied', 'unavailable',
]

describe('mapGeolocationError', () => {
  it('PERMISSION_DENIED (1) → permission-denied', () => {
    expect(mapGeolocationError(1)).toBe('permission-denied')
  })

  it('POSITION_UNAVAILABLE (2) → unavailable', () => {
    expect(mapGeolocationError(2)).toBe('unavailable')
  })

  it('TIMEOUT (3) → unavailable (indistinguable de POSITION_UNAVAILABLE)', () => {
    expect(mapGeolocationError(3)).toBe('unavailable')
  })
})

describe('PANEL_LABEL / CAMERA_BANNER_LABEL — couverture et non-régression', () => {
  it('un libellé existe pour chaque GeoStatus, dans les deux tables', () => {
    for (const status of ALL_STATUSES) {
      expect(PANEL_LABEL[status]?.text).toBeTruthy()
      expect(CAMERA_BANNER_LABEL[status]?.text).toBeTruthy()
    }
  })

  it('jamais de libellé affirmant "GPS désactivé" — état non prouvable côté navigateur', () => {
    for (const table of [PANEL_LABEL, CAMERA_BANNER_LABEL]) {
      for (const status of ALL_STATUSES) {
        expect(table[status].text.toLowerCase()).not.toContain('gps désactivé')
      }
    }
  })

  it('seul "unavailable" propose un Réessayer — un refus de permission ne se relance pas seul', () => {
    expect(PANEL_LABEL.unavailable.retry).toBe(true)
    expect(PANEL_LABEL['permission-denied'].retry).toBe(false)
  })
})
