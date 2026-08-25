import 'server-only'
import { Resvg } from '@resvg/resvg-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectivePosition, selectCrVisualEvidence, buildEvidenceNumberMap, formatClusterMarkerLabel, groupByProximity } from '@/lib/visits/geo'

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
  photo: '#0284c7', video: '#7c3aed',
}

interface Pos { id: string; lat: number; lng: number; kind: string; number: number }

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
  markers: Array<{ cx: number; cy: number; color: string; label: string }>,
): string {
  const imgs = tiles
    .map((t) => `<image x="${t.left.toFixed(1)}" y="${t.top.toFixed(1)}" width="${TILE}" height="${TILE}" xlink:href="data:image/png;base64,${t.b64}"/>`)
    .join('')
  // Taille alignée sur `NumberBadge` (Photos clés/Reportage, 18pt/8pt final) —
  // Vincent, retouche présentation 2026-08-26 : « c'est la carte qui doit
  // s'aligner sur cette grammaire, pas l'inverse ». Ce SVG est baké à 2× la
  // boîte finale du PDF (W/H ci-dessus = 2 × 515×200), donc r=19/font-size=19
  // ≈ 19pt de diamètre final, au moins aussi net que le badge des Photos clés.
  // Un repère groupé (Lot 4.1, 2026-08-25) affiche les NUMÉROS des preuves
  // qu'il contient, séparés par « · » (ex. « 3 · 4 »), jamais un simple compte
  // ni une plage « a–b » qui se lit comme un intervalle — sur le papier, un
  // repère ne se tape pas, l'étiquette doit donc être auto-suffisante.
  // `loadSystemFonts` est requis pour que le <text> soit bien rendu par Resvg
  // (vérifié : sans lui, le texte disparaît silencieusement).
  const dots = markers
    .map((m) => {
      if (m.label.length <= 2) {
        return (
          `<circle cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="19" fill="${escapeXml(m.color)}" stroke="#ffffff" stroke-width="3"/>` +
          `<text x="${m.cx.toFixed(1)}" y="${(m.cy + 6.5).toFixed(1)}" font-size="19" font-family="Helvetica, Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(m.label)}</text>`
        )
      }
      // Pastille proche de la taille du marqueur simple (r=19, soit un
      // diamètre de 38) — pas de surdimensionnement : même hauteur, largeur
      // ajustée au strict nécessaire pour l'étiquette à points séparateurs.
      const w = Math.max(38, m.label.length * 10 + 16)
      const h = 38
      const x = m.cx - w / 2
      const y = m.cy - h / 2
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${escapeXml(m.color)}" stroke="#ffffff" stroke-width="3"/>` +
        `<text x="${m.cx.toFixed(1)}" y="${(m.cy + 5.5).toFixed(1)}" font-size="16" font-family="Helvetica, Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(m.label)}</text>`
      )
    })
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

  // Même filtrage ET même ordre que listVisitCaptures() (lib/db/visit-captures.ts)
  // — buildVisitCrDoc() y numérote ses preuves dans cet ordre précis. L'instantané
  // DOIT reproduire exactement ce tri, sinon un même média porterait deux numéros
  // différents selon qu'on le lit sur la carte ou dans le reportage (Lot 4).
  // `included_in_cr` manquait ici avant Lot 4 : une capture non retenue au CR
  // pouvait apparaître sur la carte alors qu'absente du reportage — corrigé.
  const { data: caps } = await supabase
    .from('visit_capture')
    .select('id, lat, lng, corrected_lat, corrected_lng, kind, status, included_in_cr, captured_at, created_at')
    .eq('report_id', reportId)
    .is('hidden_at', null)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('captured_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  const eligible = selectCrVisualEvidence((caps ?? []) as Array<{
    id: string; lat: number | null; lng: number | null; corrected_lat: number | null; corrected_lng: number | null
    kind: string; status: string; included_in_cr: boolean; captured_at: string | null; created_at: string
  }>)
  const evidenceNumberById = buildEvidenceNumberMap(eligible)
  const positions: Pos[] = eligible.flatMap((c) => {
    const pos = resolveEffectivePosition({ lat: c.lat, lng: c.lng, correctedLat: c.corrected_lat, correctedLng: c.corrected_lng })
    return pos ? [{ id: c.id, lat: pos.lat, lng: pos.lng, kind: c.kind, number: evidenceNumberById.get(c.id) ?? 0 }] : []
  })
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

  // Regroupement spatial stable (Lot Cartographie CR, 2026-08-26) — décidé UNE
  // FOIS en lat/lng (mètres), avant toute projection, avec le même algorithme
  // que le schéma live (ObservationMap) : même groupe, quel que soit le zoom
  // ou l'échelle de rendu de CE renderer. Seule la position de chaque
  // centroïde est ensuite projetée ici, pour ce cadre précis.
  const groups = groupByProximity(positions)
  const markers = groups.map((g) => {
    const w = project(g.lat, g.lng, z)
    const single = g.points.length === 1 ? g.points[0] : null
    return {
      cx: w.x - originX,
      cy: w.y - originY,
      color: single ? (KIND_COLOR[single.kind] ?? '#6b7280') : '#334155',
      label: single ? String(single.number) : formatClusterMarkerLabel(g.points.map((p) => p.number)),
    }
  })

  let png: Buffer
  try {
    // `loadSystemFonts` requis pour que les numéros bakés (<text>) soient rendus
    // par Resvg — sans lui, le texte disparaît silencieusement (Lot 4, vérifié
    // via _resvg_text_test.mjs).
    png = Buffer.from(new Resvg(buildSvg(tiles, markers), { font: { loadSystemFonts: true } }).render().asPng())
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
