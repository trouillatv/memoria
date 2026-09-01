// Point 7A — continuité objet → source : route canonique + provenance réserve.
//
// Deux garanties figées ici :
//  1. Une visite terrain ET un PV importé ouvrent LA MÊME page source (la page
//     visite), sur desktop comme sur mobile — jamais la fiche réunion allégée.
//     Une réunion garde sa route dédiée. C'est la suppression des « chemins
//     concurrents » (/reunion ici, /visites ailleurs pour le même objet).
//  2. Un PV importé sur mobile n'est plus un cul-de-sac : `mobileSourceHref('pv')`
//     renvoie la page visite quand `report_id` existe (l'anomalie UX corrigée).
//  3. La réserve remonte à sa source UNIQUEMENT via `report_id` réel — aucune
//     source inventée si la colonne est vide ou le report a disparu.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mobileSourceHref, desktopSourceHref } from '@/lib/knowledge/action-provenance'

describe('Route source canonique — desktop', () => {
  const ids = { siteId: 's1', reportId: 'r1' }

  it('visite ET pv → LA page visite /sites/[site]/visites/[report] (même route, pas /reunion)', () => {
    expect(desktopSourceHref('visite', ids)).toBe('/sites/s1/visites/r1')
    expect(desktopSourceHref('pv', ids)).toBe('/sites/s1/visites/r1')
  })

  it('réunion → sa fiche dédiée /sites/[site]/reunion/[report]', () => {
    expect(desktopSourceHref('reunion', ids)).toBe('/sites/s1/reunion/r1')
  })

  it('réserve → écran réserves ; sujet → null (porte un subjectId, pas un reportId)', () => {
    expect(desktopSourceHref('reserve', ids)).toBe('/sites/s1/reserves')
    expect(desktopSourceHref('sujet', ids)).toBeNull()
  })

  it('sans reportId, une source report n’a pas de route (jamais un lien mort)', () => {
    const noId = { siteId: 's1', reportId: null }
    expect(desktopSourceHref('visite', noId)).toBeNull()
    expect(desktopSourceHref('pv', noId)).toBeNull()
    expect(desktopSourceHref('reunion', noId)).toBeNull()
  })
})

describe('Route source canonique — mobile', () => {
  const ids = { siteId: 's1', reportId: 'r1' }

  it('pv n’est plus un cul-de-sac : visite ET pv → /m/visite/[report]', () => {
    expect(mobileSourceHref('visite', ids)).toBe('/m/visite/r1')
    expect(mobileSourceHref('pv', ids)).toBe('/m/visite/r1')
  })

  it('réunion → /m/reunion/[report] ; réserve → /m/site/[site]/reserves ; sujet → null', () => {
    expect(mobileSourceHref('reunion', ids)).toBe('/m/reunion/r1')
    expect(mobileSourceHref('reserve', ids)).toBe('/m/site/s1/reserves')
    expect(mobileSourceHref('sujet', ids)).toBeNull()
  })

  it('sans reportId, pas de route mobile', () => {
    const noId = { siteId: 's1', reportId: null }
    expect(mobileSourceHref('pv', noId)).toBeNull()
    expect(mobileSourceHref('visite', noId)).toBeNull()
  })
})

// ── Résolveur de source réserve (comportemental) ──────────────────────────────

let reports: Array<{ id: string; origin: string | null; started_at: string | null; created_at: string }> = []

const fakeClient = {
  from: () => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      in: () => b,
      eq: () => b,
      is: () => Promise.resolve({ data: reports, error: null }),
    })
    return b
  },
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient }))

const { resolveReserveSourceLinks } = await import('@/lib/db/site-reserve')

beforeEach(() => { reports = [] })

describe('resolveReserveSourceLinks — provenance réserve, structurelle uniquement', () => {
  it('réserve issue d’un PV importé → lien PV vers la page visite (mobile + desktop)', async () => {
    reports = [{ id: 'rep-pv', origin: 'import', started_at: '2025-07-22T00:00:00Z', created_at: '2025-07-22T00:00:00Z' }]
    const map = await resolveReserveSourceLinks([{ id: 'res-1', reportId: 'rep-pv' }], 's1')
    const src = map.get('res-1')
    expect(src).toBeDefined()
    expect(src!.type).toBe('pv')
    expect(src!.line).toContain('Issue du PV')
    expect(src!.mobileHref).toBe('/m/visite/rep-pv')
    expect(src!.desktopHref).toBe('/sites/s1/visites/rep-pv')
  })

  it('réserve sans report_id → aucune entrée (pas de source, pas de lien)', async () => {
    const map = await resolveReserveSourceLinks([{ id: 'res-2', reportId: null }], 's1')
    expect(map.has('res-2')).toBe(false)
  })

  it('report_id présent mais report introuvable → aucune source inventée', async () => {
    reports = [] // le report n'existe pas / supprimé
    const map = await resolveReserveSourceLinks([{ id: 'res-3', reportId: 'rep-ghost' }], 's1')
    expect(map.has('res-3')).toBe(false)
  })
})
