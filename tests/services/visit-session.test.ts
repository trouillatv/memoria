import { describe, it, expect } from 'vitest'
import { splitByGap, SESSION_GAP_MAX_MS } from '@/services/ingestion/visit-session'

// La brique de session est PURE et déterministe : c'est le cœur de la
// reconstruction (« ce lot = une visite ou deux ? »). On la teste sans base.

const H = 60 * 60 * 1000
const at = (iso: string) => Date.parse(iso)

describe('splitByGap — découpe d’un lot en sessions de visite', () => {
  it('regroupe des captures rapprochées dans une seule visite', () => {
    const t0 = at('2026-07-01T09:00:00Z')
    const ms = [t0, t0 + 5 * 60 * 1000, t0 + 30 * 60 * 1000] // 0, +5min, +30min
    expect(splitByGap(ms)).toEqual([0, 0, 0])
  })

  it('ouvre une nouvelle visite au-delà de GAP_MAX', () => {
    const t0 = at('2026-07-01T09:00:00Z')
    const ms = [t0, t0 + SESSION_GAP_MAX_MS + 1] // écart > 4 h
    expect(splitByGap(ms)).toEqual([0, 1])
  })

  it('ne coupe pas pour une pause déjeuner (< 4 h, même jour)', () => {
    const t0 = at('2026-07-01T11:30:00Z')
    const ms = [t0, t0 + 3 * H] // 11h30 → 14h30, même journée
    expect(splitByGap(ms)).toEqual([0, 0])
  })

  it('découpe un dump de deux jours en deux visites', () => {
    const day1 = at('2026-07-01T14:00:00Z')
    const day2 = at('2026-07-02T09:00:00Z')
    const ms = [day1, day1 + 10 * 60 * 1000, day2, day2 + 5 * 60 * 1000]
    expect(splitByGap(ms)).toEqual([0, 0, 1, 1])
  })

  it('coupe au franchissement de minuit même si l’écart est court', () => {
    const beforeMidnight = at('2026-07-01T23:50:00Z')
    const afterMidnight = at('2026-07-02T00:10:00Z') // +20 min mais nouveau jour
    expect(splitByGap([beforeMidnight, afterMidnight])).toEqual([0, 1])
  })

  it('rattache les instants inconnus (null) à la session courante sans couper', () => {
    const t0 = at('2026-07-01T09:00:00Z')
    const ms = [t0, null, t0 + 10 * 60 * 1000]
    expect(splitByGap(ms)).toEqual([0, 0, 0])
  })

  it('gère un lot vide', () => {
    expect(splitByGap([])).toEqual([])
  })
})
