// Météo Open-Meteo (commit 2) — fonctions PURES (mapping/seuils), sans réseau.
// Doctrine : la météo documente ; suggérer une intempérie ≠ créer un blocage.

import { describe, it, expect } from 'vitest'
import {
  mapWmoToWeatherCode,
  suggestIntemperie,
  weatherMetricsSummary,
  endpointForDate,
} from '@/services/weather/open-meteo'

describe('mapWmoToWeatherCode — code WMO → enum journal', () => {
  it('ciel clair / nuageux', () => {
    expect(mapWmoToWeatherCode(0, 0, 5, 24)).toBe('clear')
    expect(mapWmoToWeatherCode(2, 0, 5, 24)).toBe('cloudy')
    expect(mapWmoToWeatherCode(45, 0, 5, 24)).toBe('cloudy')
  })

  it('pluie vs forte pluie (seuil 20 mm)', () => {
    expect(mapWmoToWeatherCode(61, 4, 10, 25)).toBe('rain')
    expect(mapWmoToWeatherCode(63, 25, 10, 25)).toBe('heavy_rain')
  })

  it('orage prime sur tout', () => {
    expect(mapWmoToWeatherCode(95, 0, 5, 25)).toBe('storm')
    expect(mapWmoToWeatherCode(99, 50, 70, 35)).toBe('storm')
  })

  it('vent fort / chaleur via seuils', () => {
    expect(mapWmoToWeatherCode(1, 0, 55, 24)).toBe('wind')
    expect(mapWmoToWeatherCode(0, 0, 5, 34)).toBe('heat')
  })

  it('code inconnu / null → other', () => {
    expect(mapWmoToWeatherCode(null, null, null, null)).toBe('other')
    expect(mapWmoToWeatherCode(75, 0, 5, 0)).toBe('other') // neige : hors enum NC
  })
})

describe('suggestIntemperie — suggestion (jamais auto-appliquée)', () => {
  it('forte pluie / vent violent / orage → suggérée', () => {
    expect(suggestIntemperie({ precipitationMm: 22, windMaxKmh: 10, wmoCode: 63 })).toBe(true)
    expect(suggestIntemperie({ precipitationMm: 0, windMaxKmh: 65, wmoCode: 1 })).toBe(true)
    expect(suggestIntemperie({ precipitationMm: 0, windMaxKmh: 0, wmoCode: 95 })).toBe(true)
  })
  it('temps calme → non suggérée', () => {
    expect(suggestIntemperie({ precipitationMm: 3, windMaxKmh: 20, wmoCode: 2 })).toBe(false)
  })
})

describe('weatherMetricsSummary — phrase courte opposable', () => {
  it('compose pluie / vent / chaleur au-delà des seuils', () => {
    expect(weatherMetricsSummary({ precipitationMm: 42, windMaxKmh: 55, tempMax: 34 })).toBe('pluie 42 mm · vent 55 km/h · 34 °C')
  })
  it('ignore le négligeable', () => {
    expect(weatherMetricsSummary({ precipitationMm: 0, windMaxKmh: 10, tempMax: 26 })).toBeNull()
  })
})

describe('endpointForDate — archive vs forecast', () => {
  it('passé lointain → archive', () => {
    expect(endpointForDate('2026-01-01', '2026-06-24')).toBe('archive')
  })
  it('aujourd’hui / récent → forecast', () => {
    expect(endpointForDate('2026-06-24', '2026-06-24')).toBe('forecast')
    expect(endpointForDate('2026-06-21', '2026-06-24')).toBe('forecast')
  })
})
