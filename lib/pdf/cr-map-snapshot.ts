import 'server-only'
import { Resvg } from '@resvg/resvg-js'
import { createAdminClient } from '@/lib/supabase/admin'

// « Instantané carte » du compte-rendu. Le PDF ne fabrique JAMAIS la carte : cette
// image est produite UNE SEULE FOIS (à l'ouverture de l'aperçu), stockée sur le
// compte-rendu, puis réutilisée. Les tuiles OpenStreetMap sont assemblées ICI,
// côté serveur, avec un User-Agent propre — jamais au moment de générer le PDF.
//
// Garde-fous (demande terrain) : génération unique par CR (jamais ré-fabriquée si
// elle existe déjà = cache), garde-fou sur le nombre de tuiles, timeout par tuile,
// et repli complet : la moindre indisponibilité → on renvoie null → le PDF retombe
// sur le schéma métrique. Le compte-rendu est toujours généré.

const BUCKET = 'site-reports'
// Rendu à 2× la boîte carte du PDF (515 × 200 pt) pour rester net à l'impression.
const W = 1030
const H = 400
const TILE = 256
const PICK_MAX_ZOOM = 18 // niveau rue ; au-delà, un point seul serait sur-zoomé
const MAX_TILES = 30 // garde-fou : jamais un déluge de requêtes OSM
const TILE_TIMEOUT_MS = 4000
const OSM_UA = 'MemorIA/1.0 (compte-rendu de visite; +https://memoria.app)'

const KIND_COLOR: Record<string, string> = {
  photo: '#0284c7', video: '#7c3aed', vocal: '#d97706', note: '#475569', verification: '#059669', position: '#6b7280',
}

interface Pos { lat: number; lng: number; kind: string }

// Projection Web Mercator → pixels monde (tuiles de 256 px) au zoom z.
function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n * TILE
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE
  return { x, y }
}

// Plus grand zoom où la bbox tient dans le cadre (avec marge). Point unique → max.
function pickZoom(minLat: number, maxLat: number, minLng: number, maxLng: number): number {
  const USABLE = 0.8
  for (let z = PICK_MAX_ZOOM; z >= 1; z--) {
    const w = Math.abs(project(0, maxLng, z).x - project(0, minLng, z).x)
    const h = Math.abs(project(minLat, 0, z).y - project(maxLat, 0, z).y)
    if (w <= W * USABLE && h <= H * USABLE) return z
  }
  return 1
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TILE_TIMEOUT_MS)
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': OSM_UA, Referer: 'https://memoria.app' },
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

function buildSvg(
  tiles: Array<{ left: number; top: number; b64: string }>,
  markers: Array<{ cx: number; cy: number; color: string }>,
): string {
  const imgs = tiles
    .map((t) => `<image x="${t.left.toFixed(1)}" y="${t.top.toFixed(1)}" width="${TILE}" height="${TILE}" xlink:href="data:image/png;base64,${t.b64}"/>`)
    .join('')
  const dots = markers
    .map((m) => `<circle cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="10" fill="${escapeXml(m.color)}" stroke="#ffffff" stroke-width="3"/>`)
    .join('')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="${W}" height="${H}" fill="#e5e7eb"/>${imgs}${dots}</svg>`
}

/**
 * Produit (une seule fois) et stocke l'instantané carte du CR. Renvoie le chemin
 * storage, ou null si rien à cartographier / tuiles indisponibles (→ le PDF
 * retombera sur le schéma métrique). Idempotent : si l'instantané existe déjà,
 * on ne le refabrique jamais.
 */
export async function ensureCrMapSnapshot(reportId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('id, tenant_id, cr_map_snapshot_path')
    .eq('id', reportId)
    .maybeSingle()
  if (!report) return null
  const existing = (report as { cr_map_snapshot_path: string | null }).cr_map_snapshot_path
  if (existing) return existing // déjà produit → cache, aucune requête OSM

  const { data: caps } = await supabase
    .from('visit_capture')
    .select('lat, lng, kind')
    .eq('report_id', reportId)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
  const positions: Pos[] = ((caps ?? []) as Array<{ lat: number | null; lng: number | null; kind: string }>)
    .filter((c): c is Pos => c.lat != null && c.lng != null)
  if (positions.length === 0) return null

  const lats = positions.map((p) => p.lat)
  const lngs = positions.map((p) => p.lng)
  const z = pickZoom(Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs))
  const center = project((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2, z)
  const originX = center.x - W / 2
  const originY = center.y - H / 2
  const nTiles = 2 ** z

  // Tuiles couvrant le cadre (x enroulé, y borné aux tuiles valides).
  const coords: Array<{ tx: number; wx: number; ty: number }> = []
  for (let tx = Math.floor(originX / TILE); tx <= Math.floor((originX + W) / TILE); tx++) {
    for (let ty = Math.floor(originY / TILE); ty <= Math.floor((originY + H) / TILE); ty++) {
      if (ty < 0 || ty >= nTiles) continue
      coords.push({ tx, wx: ((tx % nTiles) + nTiles) % nTiles, ty })
    }
  }
  if (coords.length === 0 || coords.length > MAX_TILES) return null

  const fetched = await Promise.all(
    coords.map(async (c) => {
      const buf = await fetchTile(z, c.wx, c.ty)
      return buf ? { left: c.tx * TILE - originX, top: c.ty * TILE - originY, b64: buf.toString('base64') } : null
    }),
  )
  const tiles = fetched.filter((t): t is NonNullable<typeof t> => t != null)
  if (tiles.length === 0) return null // réseau / OSM indisponible → fallback schéma

  const markers = positions.map((p) => {
    const w = project(p.lat, p.lng, z)
    return { cx: w.x - originX, cy: w.y - originY, color: KIND_COLOR[p.kind] ?? '#6b7280' }
  })

  let png: Buffer
  try {
    png = Buffer.from(new Resvg(buildSvg(tiles, markers)).render().asPng())
  } catch {
    return null
  }

  const path = `${(report as { tenant_id: string }).tenant_id}/${reportId}/cr-map.png`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) return null
  await supabase.from('site_reports').update({ cr_map_snapshot_path: path }).eq('id', reportId)
  return path
}

/** Charge l'instantané carte (data URI PNG) pour l'embarquer dans le PDF. */
export async function loadCrMapSnapshotDataUri(reportId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('cr_map_snapshot_path')
    .eq('id', reportId)
    .maybeSingle()
  const path = (report as { cr_map_snapshot_path: string | null } | null)?.cr_map_snapshot_path
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return `data:image/png;base64,${buf.toString('base64')}`
}
