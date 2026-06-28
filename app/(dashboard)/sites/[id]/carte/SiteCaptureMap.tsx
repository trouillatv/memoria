'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap } from 'leaflet'

// Carte V0 des CAPTURES géolocalisées (Vincent 2026-06-29). Répond à « où les
// observations ont-elles été faites ? ». Markers vectoriels simples (circleMarker,
// zéro asset d'icône à bundler), tuiles OSM gratuites. PAS de plan bâtiment, zones,
// étages, tracking continu ni itinéraire — test cheap, jetable.
//
// Leaflet est importé DANS l'effet (jamais au SSR : il touche window/document).

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
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch))
}

export function SiteCaptureMap({ siteId, captures }: { siteId: string; captures: MapCapture[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19,
      }).addTo(map)

      const markers = captures.map((c) => {
        const color = KIND_COLOR[c.kind] ?? '#6b7280'
        const m = L.circleMarker([c.lat, c.lng], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
        const date = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        const excerpt = c.body ? `<div style="margin-top:4px">${escapeHtml(c.body.slice(0, 140))}</div>` : ''
        m.bindPopup(
          `<strong>${KIND_LABEL[c.kind] ?? c.kind}</strong>` +
          `<div style="color:#666;font-size:11px">${date}</div>${excerpt}` +
          `<a href="/sites/${siteId}/visites/${c.reportId}" style="display:inline-block;margin-top:6px;color:#2563eb">Voir la visite →</a>`,
        )
        m.addTo(map)
        return m
      })

      if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
      else map.setView([0, 0], 2)
    })

    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null }
  }, [captures, siteId])

  return <div ref={ref} className="h-[70vh] w-full overflow-hidden rounded-xl border border-border" />
}
