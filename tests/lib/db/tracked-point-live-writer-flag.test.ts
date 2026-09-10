import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isTrackedPointLiveWriterEnabledForSite } from '@/lib/db/tracked-point-live-writer-flag'

const SITE_A = '11111111-1111-1111-1111-111111111111'
const SITE_B = '22222222-2222-2222-2222-222222222222'
const ENV_KEY = 'TRACKED_POINT_LIVE_WRITER_SITE_IDS'

describe('isTrackedPointLiveWriterEnabledForSite', () => {
  const original = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it('var absente → OFF', () => {
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it('var vide → OFF', () => {
    process.env[ENV_KEY] = ''
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it('var blanche (espaces) → OFF', () => {
    process.env[ENV_KEY] = '   '
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it('site absent de la liste → OFF', () => {
    process.env[ENV_KEY] = SITE_B
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it('site présent (UUID unique) → ON pour ce site uniquement', () => {
    process.env[ENV_KEY] = SITE_A
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_B)).toBe(false)
  })

  it('plusieurs UUID séparés par virgule (avec espaces) → chacun ON', () => {
    process.env[ENV_KEY] = ` ${SITE_A} , ${SITE_B} `
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_B)).toBe(true)
  })

  it('comparaison insensible à la casse', () => {
    process.env[ENV_KEY] = SITE_A.toUpperCase()
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
  })

  it('un token invalide dans la liste → configuration entière invalide → OFF pour tous, y compris les UUID par ailleurs valides', () => {
    process.env[ENV_KEY] = `${SITE_A},not-a-uuid`
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_B)).toBe(false)
  })

  it('liste réduite à des virgules/espaces sans token exploitable → OFF', () => {
    process.env[ENV_KEY] = ' , , '
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it("valeur '*' (rollout global) → ON pour n'importe quel site", () => {
    process.env[ENV_KEY] = '*'
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_B)).toBe(true)
  })

  it("'*' entouré d'espaces → ON pour tous", () => {
    process.env[ENV_KEY] = '  *  '
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
  })

  it("kill-switch : variable vide → OFF même après un rollout global précédent (pas de cache)", () => {
    process.env[ENV_KEY] = '*'
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(true)
    process.env[ENV_KEY] = ''
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
  })

  it("mélange '*' avec un UUID → configuration invalide → OFF pour tous (fail-closed)", () => {
    process.env[ENV_KEY] = `*,${SITE_A}`
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_A)).toBe(false)
    expect(isTrackedPointLiveWriterEnabledForSite(SITE_B)).toBe(false)
  })
})
