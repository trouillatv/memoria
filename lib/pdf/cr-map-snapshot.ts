import 'server-only'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectivePosition, selectCrVisualEvidence, buildEvidenceNumberMap, formatClusterMarkerLabel, groupByProximity } from '@/lib/visits/geo'
import { satelliteBaseLayer, isSatelliteAvailable, type MapBaseLayerId } from '@/lib/field/map-base-layers'
import { resolveLabelCollisions, type CrMapPlacedLabelMarker } from '@/lib/pdf/cr-map-label-collision'

// Police embarquée dans le repo (copie de pdfjs-dist/standard_fonts, licence
// SIL OFL) — nécessaire car `loadSystemFonts` échoue SILENCIEUSEMENT en
// production (Vercel serverless n'a aucune police système installée) : les
// numéros de repère disparaissaient du PNG sans erreur, alors qu'ils
// s'affichaient en local (poste de dev = polices système présentes). Preuve
// visuelle : _resvg_text_test_nofonts.png (Lot correctif carte PDF, 2026-08-27).
const FONT_PATH = path.join(process.cwd(), 'lib/pdf/assets/fonts/LiberationSans-Bold.ttf')
export const FONT_FAMILY = 'Liberation Sans'

// Version du moteur de rendu carte (Vincent, correction durable Bug A,
// 2026-08-27) — À INCRÉMENTER à chaque changement du rendu produit
// (typographie, clustering, couleurs, tuilage...), jamais seulement documenté
// en commentaire : `ensureCrMapSnapshot` régénère tout snapshot dont
// `cr_map_snapshot_render_version` diffère de cette constante, même si le
// fond Plan/Satellite n'a pas changé. Remplace une invalidation ponctuelle
// par date de commit (non réutilisable pour un futur changement de moteur).
// v2 (2026-08-27) : correction MIME tuiles — fetchTile()/buildSvg() ne
// forcent plus `image/png`, chaque tuile transporte son type réel (Satellite
// Mapbox = JPEG). Les snapshots Satellite v1 étaient rendus avec un fond gris
// (tuiles JPEG injectées sous MIME PNG, non décodées par Resvg).
// v3 (2026-08-27) : résolution déterministe des collisions entre pastilles
// après projection écran (lib/pdf/cr-map-label-collision.ts, recette
// DIMENC-Sireis) — deux groupes géographiquement proches ne produisent plus
// deux rectangles qui se chevauchent. Regroupement, numéros et centres de
// groupe inchangés, seul le placement écran de l'étiquette est corrigé.
export const CURRENT_CR_MAP_RENDER_VERSION = 3

/**
 * Un instantané stocké ne peut être réutilisé QUE s'il a été produit avec le
 * fond actuellement choisi ET avec la version courante du moteur de rendu —
 * les deux critères sont indépendants (Vincent, 2026-08-27). Extrait en
 * fonction pure pour être testable sans base de données ni réseau.
 */
export function isCrMapSnapshotFresh(
  snapshot: { path: string | null; baseLayer: MapBaseLayerId | null; renderVersion: number | null },
  chosen: MapBaseLayerId,
): boolean {
  return (
    snapshot.path != null &&
    snapshot.baseLayer === chosen &&
    snapshot.renderVersion === CURRENT_CR_MAP_RENDER_VERSION
  )
}

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

// Plan → moteur OSM inchangé. Satellite → même contrat fournisseur que les
// cartes interactives (satelliteBaseLayer(), map-base-layers.ts), tuiles
// substituées ici côté serveur — aucune nouvelle clé, aucune nouvelle config
// Mapbox (Vincent, Lot Carte PDF Plan/Satellite, 2026-08-26).
function tileUrl(layer: MapBaseLayerId, z: number, x: number, y: number, mapboxToken: string | null): string {
  if (layer === 'satellite' && mapboxToken) {
    return satelliteBaseLayer(mapboxToken).tileUrl
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
}

export interface TileData {
  buffer: Buffer
  mimeType: string
}

// OSM (Plan) sert du PNG, Mapbox Satellite sert du JPEG — jamais le même
// type. Repli utilisé quand le Content-Type HTTP est absent ou inexploitable.
function defaultTileMimeType(layer: MapBaseLayerId): string {
  return layer === 'satellite' ? 'image/jpeg' : 'image/png'
}

async function fetchTile(z: number, x: number, y: number, layer: MapBaseLayerId, mapboxToken: string | null): Promise<TileData | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TILE_TIMEOUT_MS)
  try {
    const res = await fetch(tileUrl(layer, z, x, y, mapboxToken), {
      headers: layer === 'satellite' ? {} : { 'User-Agent': OSM_UA, Referer: 'https://memoria.app' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      // Carte PDF Satellite grise en production (Vincent, 2026-08-27) —
      // cause racine PROUVÉE (voir defaultTileMimeType/buildSvg) : les tuiles
      // JPEG de Mapbox étaient injectées sous un data URI `image/png` forcé,
      // que Resvg ne décode pas — le fond gris du SVG restait visible.
      if (layer === 'satellite') console.error(`[cr-map-snapshot] tuile satellite ${z}/${x}/${y} refusée : HTTP ${res.status}`)
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    // Content-Type HTTP réel si exploitable (Vincent : vérifier sans bloquer
    // sur une valeur trop stricte type charset) ; sinon repli par fond. Chaque
    // tuile transporte désormais son type réel jusqu'à buildSvg() — plus de
    // MIME forcé à image/png.
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null
    const mimeType = contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/jpg' ? contentType : defaultTileMimeType(layer)
    return { buffer, mimeType }
  } catch (e) {
    if (layer === 'satellite') console.error(`[cr-map-snapshot] tuile satellite ${z}/${x}/${y} en échec :`, e instanceof Error ? e.message : e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

export function buildSvg(
  tiles: Array<{ left: number; top: number; b64: string; mimeType: string }>,
  markers: Array<{ cx: number; cy: number; color: string; label: string; ox?: number; oy?: number }>,
): string {
  const imgs = tiles
    .map((t) => `<image x="${t.left.toFixed(1)}" y="${t.top.toFixed(1)}" width="${TILE}" height="${TILE}" xlink:href="data:${t.mimeType};base64,${t.b64}"/>`)
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
  // `font-family` DOIT correspondre à `FONT_FAMILY` (police embarquée
  // explicitement via `fontFiles`, cf. ensureCrMapSnapshot) — Resvg ne fait
  // aucun repli automatique vers une police non chargée.
  const dots = markers
    .map((m) => {
      // Trait de rappel discret (Vincent, résolution collision pastilles,
      // 2026-08-27) : uniquement quand la position d'origine (`ox`/`oy`,
      // fournie par resolveLabelCollisions) diffère réellement du rendu final
      // — les appels historiques sans ox/oy (tests, marqueurs jamais
      // déplacés) ne dessinent rien de plus.
      const leader =
        m.ox != null && m.oy != null && (Math.abs(m.ox - m.cx) > 0.5 || Math.abs(m.oy - m.cy) > 0.5)
          ? `<line x1="${m.ox.toFixed(1)}" y1="${m.oy.toFixed(1)}" x2="${m.cx.toFixed(1)}" y2="${m.cy.toFixed(1)}" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.55"/>` +
            `<circle cx="${m.ox.toFixed(1)}" cy="${m.oy.toFixed(1)}" r="3" fill="#334155" opacity="0.7"/>`
          : ''
      if (m.label.length <= 2) {
        return (
          leader +
          `<circle cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="19" fill="${escapeXml(m.color)}" stroke="#ffffff" stroke-width="3"/>` +
          `<text x="${m.cx.toFixed(1)}" y="${(m.cy + 6.5).toFixed(1)}" font-size="19" font-family="${FONT_FAMILY}" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(m.label)}</text>`
        )
      }
      // Pastille proche de la taille du marqueur simple (r=19, soit un
      // diamètre de 38) — pas de surdimensionnement : même hauteur, largeur
      // ajustée au strict nécessaire pour l'étiquette à points séparateurs.
      // Même formule que `labelBoxSize()` (cr-map-label-collision.ts) : la
      // détection de collision doit voir EXACTEMENT la boîte peinte ici.
      const w = Math.max(38, m.label.length * 10 + 16)
      const h = 38
      const x = m.cx - w / 2
      const y = m.cy - h / 2
      return (
        leader +
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${escapeXml(m.color)}" stroke="#ffffff" stroke-width="3"/>` +
        `<text x="${m.cx.toFixed(1)}" y="${(m.cy + 5.5).toFixed(1)}" font-size="16" font-family="${FONT_FAMILY}" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(m.label)}</text>`
      )
    })
    .join('')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="${W}" height="${H}" fill="#e5e7eb"/>${imgs}${dots}</svg>`
}

/**
 * Rasterise le SVG carte avec EXACTEMENT la config Resvg de production (police
 * embarquée, jamais de recherche système) — extrait pour que le test de
 * non-régression (tests/lib/cr-map-snapshot-render.test.ts) exerce le même
 * chemin de code que `ensureCrMapSnapshot`, au lieu de dupliquer ces options.
 */
function rasterize(svg: string) {
  return new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [FONT_PATH], defaultFontFamily: FONT_FAMILY } }).render()
}

export function renderMapPng(svg: string): Buffer {
  return Buffer.from(rasterize(svg).asPng())
}

/**
 * Pixels RGBA bruts du rendu (pas le PNG encodé) — exposé uniquement pour le
 * test de non-régression, qui doit inspecter l'artefact réellement produit
 * (présence de pixels blancs dans la zone du chiffre) et pas seulement le
 * balisage `<text>` d'entrée.
 */
export function renderMapPixelsForTest(svg: string): { pixels: Buffer; width: number; height: number } {
  const rendered = rasterize(svg)
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height }
}

/**
 * Produit et stocke l'instantané carte du CR. Renvoie le chemin storage, ou
 * null si rien à cartographier / tuiles indisponibles (→ le PDF retombera sur
 * le schéma métrique). Idempotent PAR FOND : un instantané existant ne sert
 * que s'il a été produit avec le fond ACTUELLEMENT choisi pour ce rapport
 * (`cr_map_base_layer`) — jamais un Plan réutilisé sous couvert de Satellite,
 * ni l'inverse (Vincent, Lot Carte PDF Plan/Satellite, 2026-08-26). Si
 * Satellite est choisi mais Mapbox indisponible (pas de jeton), on ne
 * fabrique JAMAIS un Plan de repli à sa place : on renvoie null et on
 * conserve tel quel le dernier instantané valide en base, quel que soit son
 * fond — au contrôle appelant d'exposer l'état explicite.
 */
export async function ensureCrMapSnapshot(reportId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('id, tenant_id, cr_map_snapshot_path, cr_map_base_layer, cr_map_snapshot_base_layer, cr_map_snapshot_render_version')
    .eq('id', reportId)
    .maybeSingle()
  if (!report) return null
  const row = report as {
    tenant_id: string
    cr_map_snapshot_path: string | null
    cr_map_base_layer: string | null
    cr_map_snapshot_base_layer: string | null
    cr_map_snapshot_render_version: number | null
  }
  const chosen: MapBaseLayerId = row.cr_map_base_layer === 'satellite' ? 'satellite' : 'plan'
  const snapshotLayer: MapBaseLayerId | null =
    row.cr_map_snapshot_base_layer === 'satellite' ? 'satellite' : row.cr_map_snapshot_base_layer === 'plan' ? 'plan' : null
  if (isCrMapSnapshotFresh({ path: row.cr_map_snapshot_path, baseLayer: snapshotLayer, renderVersion: row.cr_map_snapshot_render_version }, chosen)) {
    return row.cr_map_snapshot_path // déjà produit avec CE fond ET la version courante du moteur → cache
  }

  const mapboxToken = process.env.MAPBOX_TOKEN ?? null
  if (chosen === 'satellite' && !isSatelliteAvailable(mapboxToken)) return null

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
      const tile = await fetchTile(z, c.wx, c.ty, chosen, mapboxToken)
      return tile
        ? { left: c.tx * TILE - originX, top: c.ty * TILE - originY, b64: tile.buffer.toString('base64'), mimeType: tile.mimeType }
        : null
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
  // Résolution collision (Vincent, recette DIMENC-Sireis, 2026-08-27) :
  // uniquement le placement écran des pastilles, APRÈS ce calcul métier —
  // regroupement, numéros et centres de groupe ci-dessus restent inchangés.
  const placedMarkers: CrMapPlacedLabelMarker[] = resolveLabelCollisions(markers, { width: W, height: H })

  let png: Buffer
  try {
    // `loadSystemFonts: true` échouait SILENCIEUSEMENT en production (Vercel
    // serverless = zéro police système) : les numéros disparaissaient du PNG
    // sans erreur (preuve : _resvg_text_test_nofonts.png). `renderMapPng`
    // charge donc une police embarquée explicitement (`fontFiles`) et coupe
    // la recherche système, pour un rendu identique en local et en production.
    png = renderMapPng(buildSvg(tiles, placedMarkers))
  } catch {
    return null
  }

  // Chemin PAR FOND (Vincent, correction doctrine snapshot, 2026-08-26) : sans
  // ça, une régénération réussie du fond X écraserait physiquement le dernier
  // PNG valide du fond Y via `upsert`, même si le pointeur DB de Y n'est
  // jamais touché — les deux instantanés doivent pouvoir coexister en storage.
  const path = `${row.tenant_id}/${reportId}/cr-map-${chosen}.png`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) return null
  await supabase
    .from('site_reports')
    .update({ cr_map_snapshot_path: path, cr_map_snapshot_base_layer: chosen, cr_map_snapshot_render_version: CURRENT_CR_MAP_RENDER_VERSION })
    .eq('id', reportId)
  return path
}

/**
 * Invalide l'instantané carte figé d'un CR (Lot 3, correction manuelle de
 * position) : `ensureCrMapSnapshot` est idempotent par conception (jamais
 * refabriqué tant qu'un chemin existe) — une correction de position posée
 * APRÈS la première génération du PDF resterait donc invisible sans ce reset
 * explicite. Ne supprime pas le fichier storage existant (inutile, `upsert`
 * l'écrasera à la prochaine génération), seulement la référence en base.
 */
export async function invalidateCrMapSnapshot(reportId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('site_reports')
    .update({ cr_map_snapshot_path: null, cr_map_snapshot_base_layer: null, cr_map_snapshot_render_version: null })
    .eq('id', reportId)
}

export interface CrMapBaseLayerStatus {
  /** Fond effectif pour ce rapport — 'plan' par défaut tant qu'aucun choix explicite. */
  chosen: MapBaseLayerId
  /** true seulement si cr_map_base_layer a été écrit explicitement au moins une fois. */
  explicit: boolean
  /** Fond du PNG actuellement stocké, ou null si aucun instantané n'existe encore. */
  snapshotLayer: MapBaseLayerId | null
  snapshotPath: string | null
  satelliteAvailable: boolean
}

/**
 * État de lecture pur (aucune écriture) pour le contrôle "Carte du rapport" :
 * permet à l'UI de détecter un instantané périmé (Satellite choisi mais
 * dernier PNG encore en Plan, ou inversement) sans jamais l'inférer côté
 * client (Vincent, Lot Carte PDF Plan/Satellite, 2026-08-26).
 */
export async function getCrMapBaseLayerStatus(reportId: string): Promise<CrMapBaseLayerStatus> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('cr_map_base_layer, cr_map_snapshot_path, cr_map_snapshot_base_layer')
    .eq('id', reportId)
    .maybeSingle()
  const row = report as {
    cr_map_base_layer: string | null
    cr_map_snapshot_path: string | null
    cr_map_snapshot_base_layer: string | null
  } | null
  return {
    chosen: row?.cr_map_base_layer === 'satellite' ? 'satellite' : 'plan',
    explicit: row?.cr_map_base_layer === 'plan' || row?.cr_map_base_layer === 'satellite',
    snapshotLayer:
      row?.cr_map_snapshot_base_layer === 'satellite' ? 'satellite' : row?.cr_map_snapshot_base_layer === 'plan' ? 'plan' : null,
    snapshotPath: row?.cr_map_snapshot_path ?? null,
    satelliteAvailable: isSatelliteAvailable(process.env.MAPBOX_TOKEN ?? null),
  }
}

/**
 * Enregistre le choix explicite du fond de carte POUR CE RAPPORT — et
 * SEULEMENT le choix. N'écrit jamais `cr_map_snapshot_path` ni
 * `cr_map_snapshot_base_layer` : le dernier instantané valide reste
 * référencé tel quel, physiquement intact, tant qu'`ensureCrMapSnapshot()`
 * n'a pas produit et uploadé avec succès le rendu du nouveau fond. Choisir
 * Satellite puis échouer à le générer ne doit jamais faire disparaître le
 * Plan déjà disponible — la divergence `snapshotLayer !== chosen` est
 * détectée naturellement par `ensureCrMapSnapshot()` et par
 * `getCrMapBaseLayerStatus()`, jamais provoquée ici en avance de phase
 * (Vincent, correction doctrine snapshot, 2026-08-26).
 */
export async function setCrMapBaseLayer(reportId: string, layer: MapBaseLayerId): Promise<{ changed: boolean }> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('cr_map_base_layer')
    .eq('id', reportId)
    .maybeSingle()
  if (!report) return { changed: false }
  const previous: MapBaseLayerId = (report as { cr_map_base_layer: string | null }).cr_map_base_layer === 'satellite' ? 'satellite' : 'plan'
  const changed = previous !== layer
  await supabase.from('site_reports').update({ cr_map_base_layer: layer }).eq('id', reportId)
  return { changed }
}

/**
 * Charge l'instantané carte (data URI PNG) pour l'embarquer dans le PDF.
 * Refuse tout instantané dont le fond ne correspond plus au choix courant du
 * rapport (`snapshotLayer !== chosen`) : le PDF ne doit JAMAIS présenter un
 * Plan périmé comme s'il s'agissait du Satellite demandé, ni l'inverse. Dans
 * ce cas — comme en l'absence totale d'instantané — l'appelant retombe sur le
 * schéma métrique, jamais sur une substitution silencieuse (Vincent,
 * correction doctrine snapshot, 2026-08-26).
 */
export async function loadCrMapSnapshotDataUri(reportId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from('site_reports')
    .select('cr_map_snapshot_path, cr_map_base_layer, cr_map_snapshot_base_layer')
    .eq('id', reportId)
    .maybeSingle()
  const row = report as {
    cr_map_snapshot_path: string | null
    cr_map_base_layer: string | null
    cr_map_snapshot_base_layer: string | null
  } | null
  const path = row?.cr_map_snapshot_path
  if (!path) return null
  const chosen: MapBaseLayerId = row?.cr_map_base_layer === 'satellite' ? 'satellite' : 'plan'
  const snapshotLayer: MapBaseLayerId = row?.cr_map_snapshot_base_layer === 'satellite' ? 'satellite' : 'plan'
  if (snapshotLayer !== chosen) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return `data:image/png;base64,${buf.toString('base64')}`
}
