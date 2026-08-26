'use client'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type Leaflet from 'leaflet'
import type { Map as LeafletMap, TileLayer } from 'leaflet'
import { formatClusterMarkerLabel } from '@/lib/visits/geo'
import { clusterMarkersByPixel, MARKER_CLUSTER_RADIUS_PX } from '@/lib/visits/marker-cluster'
import { PLAN_BASE_LAYER, type MapBaseLayerConfig } from '@/lib/field/map-base-layers'

// Carte des CAPTURES géolocalisées — une LECTURE (pas un module) : on l'embarque
// dans le Journal et dans la lecture AO. Répond à « où ET quoi » : le marqueur
// porte le point suivi (ou un extrait) quand il existe, pas seulement le type.
// Markers vectoriels (circleMarker, zéro asset), tuiles OSM gratuites. Leaflet
// importé DANS l'effet (jamais au SSR : il touche window/document).

// Preuve visuelle uniquement (cf. lib/visits/geo.ts isMappableVisualCapture) :
// les captures fournies à ce composant ne sont plus jamais que photo/vidéo,
// mais on garde ces tables larges car la fiche observation isolée (kind seul,
// hors carte) et le popup d'un point réutilisent KIND_LABEL pour tous les types.
export const KIND_COLOR: Record<string, string> = {
  photo: '#0284c7', video: '#7c3aed', vocal: '#d97706', note: '#475569', verification: '#059669', position: '#6b7280',
}
export const KIND_LABEL: Record<string, string> = {
  photo: 'Photo', video: 'Vidéo', vocal: 'Vocal', note: 'Note', verification: 'Vérification', position: 'Position',
}

export interface MapCapture {
  id: string
  kind: string
  lat: number
  lng: number
  created_at: string
  body: string | null
  reportId: string
  subjectName: string | null
  /** Identité de preuve partagée avec le CR (Lot 4.1, 2026-08-25) — fournie
   *  UNIQUEMENT par la carte du compte-rendu. Sans elle (Journal, Patrimoine,
   *  AO, fiche observation isolée), la carte garde son rendu d'origine :
   *  points simples, sans regroupement ni badge numéroté — cf. doctrine
   *  « la numérotation reste strictement scopée à la carte du CR ». */
  number?: number
  /** Vignette de prévisualisation (photo uniquement — une vidéo garde son
   *  icône, jamais une image cassée depuis l'URL brute du fichier vidéo). */
  thumbnailUrl?: string | null
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch))
}

/** Provenance du clic (Lot correctif Observation, 2026-08-26) : propagée en
 *  query string pour que la fiche observation sache où revenir. Absente pour
 *  les appelants qui n'ont pas encore ce contrat (dashboard desktop) — la
 *  fiche retombe alors sur son fallback sûr via report_id. */
export function captureHref(id: string, linkContext?: 'cr' | 'terrain'): string {
  return linkContext ? `/m/observation/${id}?from=${linkContext}` : `/m/observation/${id}`
}

/** Le « quoi » du marqueur : le point suivi, sinon un extrait (note/vocal), sinon le type. */
function captureWhat(c: MapCapture): string {
  if (c.subjectName) return c.subjectName
  if ((c.kind === 'note' || c.kind === 'vocal') && c.body?.trim()) return c.body.trim().slice(0, 40)
  return KIND_LABEL[c.kind] ?? c.kind
}

/** Liste des preuves d'un repère groupé — thumbnail (photo) ou icône (vidéo)
 *  + « Photo N »/« Vidéo N » (Lot 4.1, requis 3 : taper un cluster doit
 *  montrer CE QU'IL CONTIENT, pas juste combien). */
function clusterPopupHtml(items: MapCapture[], linkPopups: boolean, linkContext?: 'cr' | 'terrain'): string {
  const sorted = [...items].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const rows = sorted
    .map((c) => {
      const label = escapeHtml(c.number != null ? `${KIND_LABEL[c.kind] ?? c.kind} ${c.number}` : captureWhat(c))
      const thumb = c.kind === 'photo' && c.thumbnailUrl
        ? `<img src="${escapeHtml(c.thumbnailUrl)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex:none" />`
        : `<div style="width:36px;height:36px;border-radius:4px;flex:none;background:${KIND_COLOR[c.kind] ?? '#6b7280'}22;display:flex;align-items:center;justify-content:center;color:${KIND_COLOR[c.kind] ?? '#6b7280'};font-size:10px;font-weight:600">${c.kind === 'video' ? '▶' : ''}</div>`
      // Badge numéroté uniquement quand la CR fournit un numéro — un cluster
      // Terrain (multi-visites, jamais numéroté) n'affiche pas de pastille vide.
      const badge = c.number != null
        ? `<span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9px;background:#334155;color:#fff;font-size:10px;font-weight:700;flex:none">${c.number}</span>`
        : ''
      const inner = `<div style="display:flex;align-items:center;gap:8px">${badge}${thumb}<span style="font-size:12px">${label}</span></div>`
      return linkPopups
        ? `<a href="${captureHref(c.id, linkContext)}" style="display:block;padding:4px 0;color:inherit;text-decoration:none">${inner}</a>`
        : `<div style="padding:4px 0">${inner}</div>`
    })
    .join('')
  return `<div style="max-height:240px;overflow-auto;min-width:170px"><strong>${items.length} preuves à cet endroit</strong><div style="margin-top:4px">${rows}</div></div>`
}

export function CaptureMap({ siteId, captures, heightClass = 'h-[70vh]', linkPopups = true, baseLayer = PLAN_BASE_LAYER, clusterByZoom = false, linkContext, onOpenSingle, onOpenCluster }: {
  siteId: string
  captures: MapCapture[]
  heightClass?: string
  /** false = carte INFORMATIVE (fiche observation : elle répond à « où ? »,
   *  sans lien — un point ne doit pas rouvrir sa propre fiche). */
  linkPopups?: boolean
  /** Fond de carte (Plan/Satellite) — défaut Plan/OSM, inchangé pour tous les
   *  appelants existants (lot Terrain, 2026-08-26). */
  baseLayer?: MapBaseLayerConfig
  /** Regroupement par pixel dépendant du zoom SANS numérotation CR (carte
   *  Terrain multi-visites) — mutuellement exclusif avec la numérotation CR,
   *  qui reste prioritaire si `captures` la porte. */
  clusterByZoom?: boolean
  /** Provenance propagée sur les liens du popup vers la fiche observation
   *  (Lot correctif Observation, 2026-08-26) — cf. captureHref(). Absente =
   *  comportement d'origine (dashboard desktop, fallback report_id). */
  linkContext?: 'cr' | 'terrain'
  /** Lot correctif Terrain (2026-08-26) : un marqueur SEUL ouvre directement
   *  la preuve, sans popup intermédiaire — scopé à `clusterByZoom` (Terrain) ;
   *  absent = comportement d'origine (popup Leaflet) pour tous les autres
   *  appelants (Journal, Patrimoine, AO, fiche observation). */
  onOpenSingle?: (capture: MapCapture) => void
  /** Idem pour un cluster : plus de popup Leaflet volumineux, l'appelant
   *  ouvre son propre écran/overlay plein écran avec la liste des preuves. */
  onOpenCluster?: (captures: MapCapture[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Numérotation partagée avec le CR (Lot 4.1) : seulement si CHAQUE capture
    // fournie porte un numéro — sinon (Journal, Patrimoine, AO...) on garde le
    // rendu d'origine, point par point, sans regroupement.
    const hasEvidenceNumbers = captures.length > 0 && captures.every((c) => c.number != null)
    // Regroupement Terrain (multi-visites) : jamais en même temps que la
    // numérotation CR, qui a priorité si elle est fournie.
    const useZoomClustering = clusterByZoom && !hasEvidenceNumbers

    void import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current)
      mapRef.current = map
      leafletRef.current = L
      // Le fond de carte (Plan/Satellite) est posé par l'effet séparé ci-dessous
      // (déclenché par ce `setMapReady(true)`), jamais ici : un changement de
      // fond ne doit jamais recréer cette carte ni ses marqueurs (Vincent,
      // 2026-08-26 — même pattern que LocationCorrectionMap.tsx).
      setMapReady(true)

      // Un point isolé — utilisé tel quel (branche simple) ou comme rendu d'un
      // cluster à une seule preuve (branche Terrain) : même popup/tooltip, sauf
      // quand `onOpenSingle` est fourni (Terrain, lot correctif 2026-08-26) —
      // alors le tap ouvre DIRECTEMENT la preuve, aucun popup intermédiaire.
      const addPointMarker = (c: MapCapture, at: import('leaflet').LatLngExpression) => {
        const color = KIND_COLOR[c.kind] ?? '#6b7280'
        const m = L.circleMarker(at, { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
        const what = escapeHtml(captureWhat(c))
        // Étiquette « quoi » visible au survol (desktop) ; le tap agit (mobile).
        m.bindTooltip(what, { direction: 'top', opacity: 0.9 })
        if (onOpenSingle) {
          m.on('click', () => onOpenSingle(c))
        } else {
          const date = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          const excerpt = c.body && !c.subjectName ? '' : (c.body ? `<div style="margin-top:4px">${escapeHtml(c.body.slice(0, 140))}</div>` : '')
          m.bindPopup(
            `<strong>${what}</strong>` +
            `<div style="color:#666;font-size:11px">${KIND_LABEL[c.kind] ?? c.kind} · ${date}</div>${excerpt}` +
            // Le point de carte ouvre L'OBSERVATION elle-même (média + contexte),
            // qui mène ensuite à la visite complète. Le Débrief est un outil de
            // production — jamais la destination d'un clic de consultation.
            (linkPopups
              ? `<a href="${captureHref(c.id, linkContext)}" style="display:inline-block;margin-top:6px;color:#2563eb">Voir cette observation →</a>`
              : ''),
          )
        }
        m.addTo(map)
        return m
      }

      if (!hasEvidenceNumbers && !useZoomClustering) {
        const markers = captures.map((c) => addPointMarker(c, [c.lat, c.lng]))
        if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
        else map.setView([0, 0], 2)
        return
      }

      if (useZoomClustering) {
        // Même mécanique de regroupement en PIXELS que la carte CR (cf. doctrine
        // ci-dessous), mais SANS numérotation séquentielle : Terrain traverse
        // plusieurs visites/CR, une numérotation globale n'aurait pas de sens
        // métier (elle reste strictement scopée au CR d'une visite).
        const initialBounds = L.latLngBounds(captures.map((c) => [c.lat, c.lng] as [number, number]))
        if (captures.length > 0) map.fitBounds(initialBounds.pad(0.2))
        else map.setView([0, 0], 2)

        let layers: import('leaflet').Layer[] = []
        const render = () => {
          layers.forEach((l) => map.removeLayer(l))
          layers = []
          const pts = captures.map((c) => {
            const p = map.latLngToLayerPoint([c.lat, c.lng])
            return { id: c.id, x: p.x, y: p.y, c }
          })
          const clusters = clusterMarkersByPixel(pts, MARKER_CLUSTER_RADIUS_PX)
          for (const cluster of clusters) {
            const center = map.layerPointToLatLng(L.point(cluster.x, cluster.y))
            if (cluster.points.length === 1) {
              layers.push(addPointMarker(cluster.points[0].c, center))
            } else {
              const count = cluster.points.length
              const icon = L.divIcon({
                className: '',
                html: `<div style="width:26px;height:26px;border-radius:13px;background:#334155;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${count}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
              })
              const m = L.marker(center, { icon })
              if (onOpenCluster) {
                m.on('click', () => onOpenCluster(cluster.points.map((pt) => pt.c)))
              } else {
                m.bindPopup(clusterPopupHtml(cluster.points.map((pt) => pt.c), linkPopups, linkContext))
              }
              m.addTo(map)
              layers.push(m)
            }
          }
        }
        render()
        map.on('zoomend', render)
        return
      }

      // Carte du CR (Lot Cartographie CR, correction 2026-08-26, Vincent) :
      // chaque point isolé affiche son numéro ; plusieurs preuves qui se
      // chevauchent VISUELLEMENT à l'écran forment UN SEUL repère qui affiche
      // leurs numéros (ex. « 3 · 4 »), jamais un point sans identité. Le
      // regroupement se décide en PIXELS, au zoom courant : deux preuves à
      // 20-30 m restent un seul marqueur à faible zoom, mais finissent par se
      // distinguer en zoomant (rejeté en recette : un regroupement figé en
      // mètres qui ne se séparait plus jamais, quel que soit le zoom — « ce
      // n'est pas honnête sur la distance réelle »). Le PDF statique (jamais
      // zoomable) garde `groupByProximity`, un regroupement fixe en mètres.
      const initialBounds = L.latLngBounds(captures.map((c) => [c.lat, c.lng] as [number, number]))
      if (captures.length > 0) map.fitBounds(initialBounds.pad(0.2))
      else map.setView([0, 0], 2)

      let layers: import('leaflet').Layer[] = []
      const render = () => {
        layers.forEach((l) => map.removeLayer(l))
        layers = []
        const pts = captures.map((c) => {
          const p = map.latLngToLayerPoint([c.lat, c.lng])
          return { id: c.id, x: p.x, y: p.y, c }
        })
        const clusters = clusterMarkersByPixel(pts, MARKER_CLUSTER_RADIUS_PX)
        for (const cluster of clusters) {
          const center = map.layerPointToLatLng(L.point(cluster.x, cluster.y))
          if (cluster.points.length === 1) {
            const { c } = cluster.points[0]
            const color = KIND_COLOR[c.kind] ?? '#6b7280'
            const icon = L.divIcon({
              className: '',
              html: `<div style="width:26px;height:26px;border-radius:13px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${c.number}</div>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            })
            const m = L.marker(center, { icon })
            const date = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            const label = escapeHtml(`${KIND_LABEL[c.kind] ?? c.kind} ${c.number}`)
            const excerpt = c.body ? `<div style="margin-top:4px">${escapeHtml(c.body.slice(0, 140))}</div>` : ''
            m.bindPopup(
              `<strong>${label}</strong>` +
              `<div style="color:#666;font-size:11px">${date}</div>${excerpt}` +
              (linkPopups
                ? `<a href="${captureHref(c.id, linkContext)}" style="display:inline-block;margin-top:6px;color:#2563eb">Voir cette observation →</a>`
                : ''),
            )
            m.bindTooltip(label, { direction: 'top', opacity: 0.9 })
            m.addTo(map)
            layers.push(m)
          } else {
            const numbers = cluster.points.map((pt) => pt.c.number ?? 0)
            const clusterLabel = formatClusterMarkerLabel(numbers)
            // Capsule noire horizontale (Vincent, retouche présentation
            // 2026-08-26) : numéros séparés par « · », jamais une plage « a–b »
            // qui se lit comme un intervalle. `white-space:nowrap` garantit
            // qu'elle reste une seule ligne même si l'estimation de largeur
            // sous-évalue le rendu réel des glyphes.
            const w = Math.max(26, clusterLabel.length * 6 + 16)
            const icon = L.divIcon({
              className: '',
              html: `<div style="min-width:${w}px;height:26px;padding:0 6px;border-radius:13px;background:#334155;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;white-space:nowrap">${escapeHtml(clusterLabel)}</div>`,
              iconSize: [w, 26],
              iconAnchor: [w / 2, 13],
            })
            const m = L.marker(center, { icon })
            if (onOpenCluster) {
              m.on('click', () => onOpenCluster(cluster.points.map((pt) => pt.c)))
            } else {
              m.bindPopup(clusterPopupHtml(cluster.points.map((pt) => pt.c), linkPopups, linkContext))
            }
            m.addTo(map)
            layers.push(m)
          }
        }
      }
      render()
      // Le zoom change la distance en PIXELS entre deux points GPS fixes → le
      // regroupement doit être recalculé. Un déplacement (pan) ne change pas
      // ces distances relatives : pas besoin de réagir à 'moveend'.
      map.on('zoomend', render)
    })

    return () => {
      cancelled = true
      mapRef.current?.off('zoomend')
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      tileLayerRef.current = null
      setMapReady(false)
    }
  }, [captures, siteId, linkPopups, clusterByZoom, linkContext, onOpenSingle, onOpenCluster])

  // Fond de carte (Plan/Satellite) : effet SÉPARÉ du montage — ne remplace que
  // la couche de tuiles, ne touche jamais aux marqueurs ni à la vue (même
  // pattern que LocationCorrectionMap.tsx, Vincent 2026-08-26).
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || !mapReady) return
    const layer = L.tileLayer(baseLayer.tileUrl, { attribution: baseLayer.attribution, maxZoom: baseLayer.maxZoom })
    layer.addTo(map)
    const previous = tileLayerRef.current
    tileLayerRef.current = layer
    if (previous) map.removeLayer(previous)
  }, [baseLayer, mapReady])

  // Types réellement présents : la légende ne montre jamais un type absent de
  // cette carte (plus de « Vocal »/« Note » morts depuis le filtrage preuve
  // visuelle en amont — cf. lib/visits/geo.ts isMappableVisualCapture).
  const kindsPresent = [...new Set(captures.map((c) => c.kind))]

  // `heightClass="h-full"` (carte CR plein écran) a besoin d'un ancêtre à
  // hauteur déterminée : un simple `space-y-2` (bloc, hauteur auto) casse la
  // chaîne de pourcentage et le conteneur Leaflet s'initialise à hauteur ~0
  // (bug observé par Vincent : « petite carte flottant au milieu » d'un fond
  // noir). Le wrapper est donc lui-même flex/h-full — sans ancêtre à hauteur
  // déterminée (les autres appelants, tous en `h-[..]`/`h-NN` fixes), `h-full`
  // se résout en `auto` et ne change rien à leur mise en page.
  const isFillHeight = heightClass === 'h-full'
  return (
    <div className={isFillHeight ? 'flex h-full flex-col gap-2' : 'space-y-2'}>
      <div ref={ref} className={`${isFillHeight ? 'flex-1' : heightClass} w-full overflow-hidden rounded-xl border border-border`} />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {kindsPresent.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: KIND_COLOR[k] ?? '#6b7280' }} aria-hidden />
            {KIND_LABEL[k] ?? k}
          </span>
        ))}
      </div>
    </div>
  )
}
