'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap } from 'leaflet'
import { formatEvidenceNumberLabel, groupByProximity } from '@/lib/visits/geo'

// Carte des CAPTURES géolocalisées — une LECTURE (pas un module) : on l'embarque
// dans le Journal et dans la lecture AO. Répond à « où ET quoi » : le marqueur
// porte le point suivi (ou un extrait) quand il existe, pas seulement le type.
// Markers vectoriels (circleMarker, zéro asset), tuiles OSM gratuites. Leaflet
// importé DANS l'effet (jamais au SSR : il touche window/document).

// Preuve visuelle uniquement (cf. lib/visits/geo.ts isMappableVisualCapture) :
// les captures fournies à ce composant ne sont plus jamais que photo/vidéo,
// mais on garde ces tables larges car la fiche observation isolée (kind seul,
// hors carte) et le popup d'un point réutilisent KIND_LABEL pour tous les types.
const KIND_COLOR: Record<string, string> = {
  photo: '#0284c7', video: '#7c3aed', vocal: '#d97706', note: '#475569', verification: '#059669', position: '#6b7280',
}
const KIND_LABEL: Record<string, string> = {
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

/** Le « quoi » du marqueur : le point suivi, sinon un extrait (note/vocal), sinon le type. */
function captureWhat(c: MapCapture): string {
  if (c.subjectName) return c.subjectName
  if ((c.kind === 'note' || c.kind === 'vocal') && c.body?.trim()) return c.body.trim().slice(0, 40)
  return KIND_LABEL[c.kind] ?? c.kind
}

/** Liste des preuves d'un repère groupé — thumbnail (photo) ou icône (vidéo)
 *  + « Photo N »/« Vidéo N » (Lot 4.1, requis 3 : taper un cluster doit
 *  montrer CE QU'IL CONTIENT, pas juste combien). */
function clusterPopupHtml(items: MapCapture[], linkPopups: boolean): string {
  const sorted = [...items].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const rows = sorted
    .map((c) => {
      const label = escapeHtml(`${KIND_LABEL[c.kind] ?? c.kind} ${c.number ?? ''}`.trim())
      const thumb = c.kind === 'photo' && c.thumbnailUrl
        ? `<img src="${escapeHtml(c.thumbnailUrl)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex:none" />`
        : `<div style="width:36px;height:36px;border-radius:4px;flex:none;background:${KIND_COLOR[c.kind] ?? '#6b7280'}22;display:flex;align-items:center;justify-content:center;color:${KIND_COLOR[c.kind] ?? '#6b7280'};font-size:10px;font-weight:600">${c.kind === 'video' ? '▶' : ''}</div>`
      const inner = `<div style="display:flex;align-items:center;gap:8px"><span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9px;background:#334155;color:#fff;font-size:10px;font-weight:700;flex:none">${c.number ?? ''}</span>${thumb}<span style="font-size:12px">${label}</span></div>`
      return linkPopups
        ? `<a href="/m/observation/${c.id}" style="display:block;padding:4px 0;color:inherit;text-decoration:none">${inner}</a>`
        : `<div style="padding:4px 0">${inner}</div>`
    })
    .join('')
  return `<div style="max-height:240px;overflow-auto;min-width:170px"><strong>${items.length} preuves à cet endroit</strong><div style="margin-top:4px">${rows}</div></div>`
}

export function CaptureMap({ siteId, captures, heightClass = 'h-[70vh]', linkPopups = true }: {
  siteId: string
  captures: MapCapture[]
  heightClass?: string
  /** false = carte INFORMATIVE (fiche observation : elle répond à « où ? »,
   *  sans lien — un point ne doit pas rouvrir sa propre fiche). */
  linkPopups?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    let cancelled = false
    // Numérotation partagée avec le CR (Lot 4.1) : seulement si CHAQUE capture
    // fournie porte un numéro — sinon (Journal, Patrimoine, AO...) on garde le
    // rendu d'origine, point par point, sans regroupement.
    const hasEvidenceNumbers = captures.length > 0 && captures.every((c) => c.number != null)

    void import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)

      if (!hasEvidenceNumbers) {
        const markers = captures.map((c) => {
          const color = KIND_COLOR[c.kind] ?? '#6b7280'
          const m = L.circleMarker([c.lat, c.lng], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
          const date = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          const what = escapeHtml(captureWhat(c))
          const excerpt = c.body && !c.subjectName ? '' : (c.body ? `<div style="margin-top:4px">${escapeHtml(c.body.slice(0, 140))}</div>` : '')
          m.bindPopup(
            `<strong>${what}</strong>` +
            `<div style="color:#666;font-size:11px">${KIND_LABEL[c.kind] ?? c.kind} · ${date}</div>${excerpt}` +
            // Le point de carte ouvre L'OBSERVATION elle-même (média + contexte),
            // qui mène ensuite à la visite complète. Le Débrief est un outil de
            // production — jamais la destination d'un clic de consultation.
            (linkPopups
              ? `<a href="/m/observation/${c.id}" style="display:inline-block;margin-top:6px;color:#2563eb">Voir cette observation →</a>`
              : ''),
          )
          // Étiquette « quoi » visible au survol (desktop) ; le tap ouvre le popup (mobile).
          m.bindTooltip(what, { direction: 'top', opacity: 0.9 })
          m.addTo(map)
          return m
        })

        if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
        else map.setView([0, 0], 2)
        return
      }

      // Carte du CR (Lot Cartographie CR, 2026-08-26) : chaque point isolé
      // affiche son numéro ; plusieurs preuves suffisamment proches (même
      // précision GPS, cf. SAME_SPOT_RADIUS_M) forment UN SEUL repère qui
      // affiche leurs numéros (ex. « 1–5 »), jamais un point sans identité.
      // Le regroupement se décide UNE FOIS en coordonnées réelles (mètres) —
      // pas en pixels : contrairement à l'ancien clustering par zoom, deux
      // preuves au même endroit restent groupées à n'importe quel niveau de
      // zoom (« ce n'est pas Google Maps », Vincent). Chaque marqueur est
      // ensuite posé à son centroïde lat/lng, que Leaflet replace lui-même à
      // chaque zoom/pan — aucun recalcul de regroupement n'est nécessaire.
      const initialBounds = L.latLngBounds(captures.map((c) => [c.lat, c.lng] as [number, number]))
      if (captures.length > 0) map.fitBounds(initialBounds.pad(0.2))
      else map.setView([0, 0], 2)

      const groups = groupByProximity(captures.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, c })))
      for (const group of groups) {
        const center: [number, number] = [group.lat, group.lng]
        if (group.points.length === 1) {
          const { c } = group.points[0]
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
              ? `<a href="/m/observation/${c.id}" style="display:inline-block;margin-top:6px;color:#2563eb">Voir cette observation →</a>`
              : ''),
          )
          m.bindTooltip(label, { direction: 'top', opacity: 0.9 })
          m.addTo(map)
        } else {
          const numbers = group.points.map((pt) => pt.c.number ?? 0)
          const rangeLabel = formatEvidenceNumberLabel(numbers)
          // Pastille proche de la taille d'un marqueur simple (26px) — pas le
          // gros ovale surdimensionné rejeté en recette : largeur ajustée au
          // strict nécessaire pour l'étiquette, hauteur identique au marqueur seul.
          const w = Math.max(26, rangeLabel.length * 6 + 16)
          const icon = L.divIcon({
            className: '',
            html: `<div style="min-width:${w}px;height:26px;padding:0 6px;border-radius:13px;background:#334155;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${escapeHtml(rangeLabel)}</div>`,
            iconSize: [w, 26],
            iconAnchor: [w / 2, 13],
          })
          const m = L.marker(center, { icon })
          m.bindPopup(clusterPopupHtml(group.points.map((pt) => pt.c), linkPopups))
          m.addTo(map)
        }
      }
    })

    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null }
  }, [captures, siteId, linkPopups])

  // Types réellement présents : la légende ne montre jamais un type absent de
  // cette carte (plus de « Vocal »/« Note » morts depuis le filtrage preuve
  // visuelle en amont — cf. lib/visits/geo.ts isMappableVisualCapture).
  const kindsPresent = [...new Set(captures.map((c) => c.kind))]

  return (
    <div className="space-y-2">
      <div ref={ref} className={`${heightClass} w-full overflow-hidden rounded-xl border border-border`} />
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
