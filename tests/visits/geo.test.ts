// « Pris au même endroit » — la distance haversine qui rapproche les captures.

import { describe, it, expect } from 'vitest'
import { distanceMeters, SAME_SPOT_RADIUS_M } from '@/lib/visits/geo'

describe('distanceMeters', () => {
  it('même point → 0 m', () => {
    expect(distanceMeters(-22.2758, 166.458, -22.2758, 166.458)).toBe(0)
  })

  it('~11 m pour 0,0001° de latitude (Nouméa)', () => {
    const d = distanceMeters(-22.2758, 166.458, -22.2759, 166.458)
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(13)
  })

  it('deux rues plus loin (~300 m) → hors du rayon « même endroit »', () => {
    const d = distanceMeters(-22.2758, 166.458, -22.2785, 166.458)
    expect(d).toBeGreaterThan(SAME_SPOT_RADIUS_M)
  })
})
