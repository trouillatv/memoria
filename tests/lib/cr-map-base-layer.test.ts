// Lot Carte PDF Plan/Satellite (Vincent, 2026-08-26) — couvre spécifiquement
// l'idempotence PAR FOND de ensureCrMapSnapshot() et les décisions
// d'invalidation de setCrMapBaseLayer() : jamais un Plan réutilisé sous
// couvert de Satellite (ni l'inverse), jamais de régénération silencieuse
// pour une confirmation sans changement, jamais de repli silencieux vers
// Plan quand Satellite est choisi sans jeton Mapbox.
//
// Correction doctrine snapshot (Vincent, 2026-08-26) : le CHOIX
// (cr_map_base_layer) et le SNAPSHOT (cr_map_snapshot_path /
// cr_map_snapshot_base_layer) ne doivent jamais être écrits dans la même
// opération. setCrMapBaseLayer() n'écrit QUE le choix ; le pointeur snapshot
// ne bascule qu'après un upload réussi, avec un chemin storage DISTINCT par
// fond (jamais d'écrasement physique de l'autre fond) ; en cas d'échec, le
// dernier snapshot valide reste référencé et physiquement intact ; le PDF
// (loadCrMapSnapshotDataUri) refuse tout snapshot dont le fond diverge du
// choix courant plutôt que de le présenter en silence sous un autre nom.
//
// Resvg (rendu PNG réel) est mocké : ce fichier teste NOTRE logique
// (chemins, ordre des écritures, garde-fous), pas le moteur de rendu tiers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  storageUpload: vi.fn(async (_path: string, _body: unknown, _opts?: unknown) => ({ error: null as { message: string } | null })),
  storageDownload: vi.fn(async () => ({ data: null as { arrayBuffer: () => Promise<ArrayBuffer> } | null, error: null as unknown })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mocks.from,
    storage: { from: () => ({ upload: mocks.storageUpload, download: mocks.storageDownload }) },
  }),
}))

vi.mock('@resvg/resvg-js', () => ({
  // `new Resvg(...)` exige un vrai constructeur — une implémentation fléchée
  // fait échouer `new` sur le mock (TypeError: ... is not a constructor).
  Resvg: vi.fn().mockImplementation(function MockResvg() {
    return { render: () => ({ asPng: () => new Uint8Array([1, 2, 3]) }) }
  }),
}))

import {
  ensureCrMapSnapshot, setCrMapBaseLayer, getCrMapBaseLayerStatus,
  invalidateCrMapSnapshot, loadCrMapSnapshotDataUri,
} from '@/lib/pdf/cr-map-snapshot'

function chain(data: unknown) {
  const c: Record<string, unknown> = {}
  c.select = vi.fn(() => c)
  c.eq = vi.fn(() => c)
  c.is = vi.fn(() => c)
  c.not = vi.fn(() => c)
  c.order = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => ({ data, error: null }))
  c.update = vi.fn(() => c)
  // Le vrai query builder Supabase est thenable (awaitable sans terminal
  // explicite) — nécessaire ici car ensureCrMapSnapshot() awaite directement
  // après un dernier .order() ou .update().eq(), sans .maybeSingle().
  c.then = (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data, error: null })
  return c
}

const ELIGIBLE_CAPTURE = {
  id: 'cap-1', lat: -22.27, lng: 166.44, corrected_lat: null, corrected_lng: null,
  kind: 'photo', status: 'kept', included_in_cr: true,
  captured_at: '2026-08-20T00:00:00Z', created_at: '2026-08-20T00:00:00Z',
}

beforeEach(() => {
  mocks.from.mockReset()
  mocks.storageUpload.mockReset()
  mocks.storageUpload.mockResolvedValue({ error: null })
  mocks.storageDownload.mockReset()
  delete process.env.MAPBOX_TOKEN
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ensureCrMapSnapshot — idempotence par fond', () => {
  it('renvoie le chemin existant sans toucher visit_capture si le fond stocké correspond au fond choisi', async () => {
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report/cr-map.png',
      cr_map_base_layer: 'plan',
      cr_map_snapshot_base_layer: 'plan',
    })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      throw new Error(`table ${table} ne doit jamais être interrogée en cas de cache valide`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    expect(path).toBe('tenant/report/cr-map.png')
    expect(mocks.from).toHaveBeenCalledTimes(1) // aucune requête visit_capture, aucune écriture
  })

  it('ne réutilise jamais un instantané Plan quand Satellite est le fond actuellement choisi', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test-token'
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report/cr-map.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'plan', // instantané périmé : produit avec l'AUTRE fond
    })
    // caps vide → positions.length === 0 → sortie par « rien à cartographier »,
    // mais ce qui compte ici est que le cache N'A PAS COURT-CIRCUITÉ la requête :
    // la fonction a bien tenté de régénérer plutôt que de rendre l'ancien Plan.
    const visitCaptureChain = chain([])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      if (table === 'visit_capture') return visitCaptureChain
      throw new Error(`table inattendue: ${table}`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    // Sans preuve géolocalisée, la régénération s'arrête à null — mais la
    // requête visit_capture a bien été tentée (cache jamais utilisé ici).
    expect(path).toBeNull()
    expect(mocks.from).toHaveBeenCalledWith('visit_capture')
  })

  it('ne fabrique jamais un Plan de repli quand Satellite est choisi sans jeton Mapbox', async () => {
    // MAPBOX_TOKEN absent (beforeEach)
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report/old-plan.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'plan',
    })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      throw new Error(`table ${table} ne doit jamais être interrogée sans jeton Mapbox`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    expect(path).toBeNull() // jamais l'ancien Plan renvoyé sous couvert de Satellite
    expect(mocks.from).toHaveBeenCalledTimes(1) // aucune tentative de fabrication
  })

  it('Plan → Satellite réussi : stocke sous cr-map-satellite.png et ne bascule le pointeur qu’après upload', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test-token'
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report-1/cr-map-plan.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'plan', // périmé : Satellite choisi, dernier PNG encore Plan
    })
    const visitCaptureChain = chain([ELIGIBLE_CAPTURE])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      if (table === 'visit_capture') return visitCaptureChain
      throw new Error(`table inattendue: ${table}`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    expect(path).toBe('t1/report-1/cr-map-satellite.png')
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      't1/report-1/cr-map-satellite.png',
      expect.anything(),
      expect.objectContaining({ upsert: true }),
    )
    // Le pointeur DB ne bascule QU'APRÈS l'upload réussi, jamais avant.
    expect(siteReportsChain.update).toHaveBeenCalledWith({
      cr_map_snapshot_path: 't1/report-1/cr-map-satellite.png',
      cr_map_snapshot_base_layer: 'satellite',
    })
  })

  it('Plan → Satellite échoué (tuiles indisponibles) : aucune écriture, l’ancien Plan reste tel quel', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test-token'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })))
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report-1/cr-map-plan.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'plan',
    })
    const visitCaptureChain = chain([ELIGIBLE_CAPTURE])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      if (table === 'visit_capture') return visitCaptureChain
      throw new Error(`table inattendue: ${table}`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    expect(path).toBeNull()
    expect(mocks.storageUpload).not.toHaveBeenCalled()
    expect(siteReportsChain.update).not.toHaveBeenCalled() // le pointeur Plan existant n'est jamais touché
  })

  it('Satellite → Plan échoué (upload storage en erreur) : l’ancien Satellite reste référencé', async () => {
    mocks.storageUpload.mockResolvedValue({ error: { message: 'stockage indisponible' } })
    const siteReportsChain = chain({
      tenant_id: 't1',
      cr_map_snapshot_path: 'tenant/report-1/cr-map-satellite.png',
      cr_map_base_layer: 'plan',
      cr_map_snapshot_base_layer: 'satellite', // périmé : Plan choisi, dernier PNG encore Satellite
    })
    const visitCaptureChain = chain([ELIGIBLE_CAPTURE])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      if (table === 'visit_capture') return visitCaptureChain
      throw new Error(`table inattendue: ${table}`)
    })

    const path = await ensureCrMapSnapshot('report-1')

    expect(path).toBeNull()
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      't1/report-1/cr-map-plan.png',
      expect.anything(),
      expect.objectContaining({ upsert: true }),
    )
    // Upload en échec → jamais de bascule du pointeur : le Satellite existant survit intact.
    expect(siteReportsChain.update).not.toHaveBeenCalled()
  })

  it('aucun écrasement physique entre les deux fonds — chemins storage distincts par fond', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test-token'
    const visitCaptureChain = chain([ELIGIBLE_CAPTURE])

    const planReport = chain({ tenant_id: 't1', cr_map_snapshot_path: null, cr_map_base_layer: 'plan', cr_map_snapshot_base_layer: null })
    mocks.from.mockImplementation((table: string) => (table === 'site_reports' ? planReport : visitCaptureChain))
    await ensureCrMapSnapshot('report-1')
    const planPath = mocks.storageUpload.mock.calls[0]?.[0]

    mocks.storageUpload.mockClear()
    const satReport = chain({ tenant_id: 't1', cr_map_snapshot_path: null, cr_map_base_layer: 'satellite', cr_map_snapshot_base_layer: null })
    mocks.from.mockImplementation((table: string) => (table === 'site_reports' ? satReport : visitCaptureChain))
    await ensureCrMapSnapshot('report-1')
    const satPath = mocks.storageUpload.mock.calls[0]?.[0]

    expect(planPath).toBe('t1/report-1/cr-map-plan.png')
    expect(satPath).toBe('t1/report-1/cr-map-satellite.png')
    expect(planPath).not.toBe(satPath)
  })
})

describe('setCrMapBaseLayer — invalidation ciblée', () => {
  it('enregistre SEULEMENT le choix quand le fond change — ne touche jamais au pointeur snapshot', async () => {
    const siteReportsChain = chain({ cr_map_base_layer: 'plan' })
    mocks.from.mockReturnValue(siteReportsChain)

    const result = await setCrMapBaseLayer('report-1', 'satellite')

    expect(result.changed).toBe(true)
    expect(siteReportsChain.update).toHaveBeenCalledWith({ cr_map_base_layer: 'satellite' })
    const call = (siteReportsChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call).not.toHaveProperty('cr_map_snapshot_path')
    expect(call).not.toHaveProperty('cr_map_snapshot_base_layer')
  })

  it('ne réinvalide pas une confirmation du fond déjà effectif', async () => {
    const siteReportsChain = chain({ cr_map_base_layer: null }) // jamais choisi → défaut résolu 'plan'
    mocks.from.mockReturnValue(siteReportsChain)

    const result = await setCrMapBaseLayer('report-1', 'plan')

    expect(result.changed).toBe(false)
    expect(siteReportsChain.update).toHaveBeenCalledWith({ cr_map_base_layer: 'plan' })
    const call = (siteReportsChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call).not.toHaveProperty('cr_map_snapshot_path')
  })

  it('n’écrit jamais dans visit_capture', async () => {
    const siteReportsChain = chain({ cr_map_base_layer: 'plan' })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'site_reports') return siteReportsChain
      throw new Error(`setCrMapBaseLayer ne doit jamais toucher ${table}`)
    })

    await expect(setCrMapBaseLayer('report-1', 'satellite')).resolves.toEqual({ changed: true })
  })
})

describe('invalidateCrMapSnapshot — correction GPS', () => {
  it('efface uniquement le pointeur snapshot, jamais cr_map_base_layer', async () => {
    const siteReportsChain = chain(null)
    mocks.from.mockReturnValue(siteReportsChain)

    await invalidateCrMapSnapshot('report-1')

    expect(siteReportsChain.update).toHaveBeenCalledWith({ cr_map_snapshot_path: null, cr_map_snapshot_base_layer: null })
    const call = (siteReportsChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call).not.toHaveProperty('cr_map_base_layer')
  })
})

describe('loadCrMapSnapshotDataUri — garde anti-substitution silencieuse', () => {
  it('refuse un instantané dont le fond stocké diverge du choix courant (retombe sur le schéma métrique)', async () => {
    const siteReportsChain = chain({
      cr_map_snapshot_path: 'tenant/report-1/cr-map-plan.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'plan',
    })
    mocks.from.mockReturnValue(siteReportsChain)

    const dataUri = await loadCrMapSnapshotDataUri('report-1')

    expect(dataUri).toBeNull()
    expect(mocks.storageDownload).not.toHaveBeenCalled() // jamais téléchargé pour être présenté à tort
  })

  it('charge l’instantané quand le fond stocké correspond au choix courant', async () => {
    const siteReportsChain = chain({
      cr_map_snapshot_path: 'tenant/report-1/cr-map-satellite.png',
      cr_map_base_layer: 'satellite',
      cr_map_snapshot_base_layer: 'satellite',
    })
    mocks.from.mockReturnValue(siteReportsChain)
    mocks.storageDownload.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null })

    const dataUri = await loadCrMapSnapshotDataUri('report-1')

    expect(dataUri).toMatch(/^data:image\/png;base64,/)
  })
})

describe('getCrMapBaseLayerStatus — lecture pure', () => {
  it('signale explicit=false et chosen="plan" pour un rapport historique jamais réglé', async () => {
    const siteReportsChain = chain({ cr_map_base_layer: null, cr_map_snapshot_path: 'old.png', cr_map_snapshot_base_layer: null })
    mocks.from.mockReturnValue(siteReportsChain)

    const status = await getCrMapBaseLayerStatus('report-1')

    expect(status.chosen).toBe('plan')
    expect(status.explicit).toBe(false)
    expect(status.snapshotLayer).toBeNull()
    expect(status.snapshotPath).toBe('old.png')
  })

  it('reflète un choix explicite Satellite et un instantané à jour', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test-token'
    const siteReportsChain = chain({ cr_map_base_layer: 'satellite', cr_map_snapshot_path: 'sat.png', cr_map_snapshot_base_layer: 'satellite' })
    mocks.from.mockReturnValue(siteReportsChain)

    const status = await getCrMapBaseLayerStatus('report-1')

    expect(status).toEqual({
      chosen: 'satellite', explicit: true, snapshotLayer: 'satellite', snapshotPath: 'sat.png', satelliteAvailable: true,
    })
  })
})
