'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap } from 'leaflet'

// Carte des CAPTURES géolocalisées — une LECTURE (pas un module) : on l'embarque
// dans le Journal et dans la lecture AO. Répond à « où ET quoi » : le marqueur
// porte le point suivi (ou un extrait) quand il existe, pas seulement le type.
// Markers vectoriels (circleMarker, zéro asset), tuiles OSM gratuites. Leaflet
// importé DANS l'effet (jamais au SSR : il touche window/document).

const KIND_COLOR: Record<string, string> = {
  photo: '#0284c7', video: '#7c3aed', vocal: '#d97706', note: '#475569', verification: '#059669', position: '#6b7280',
}
const KIND_LABEL: Record<string, string> = {
  photo: 'Photo', video: 'Vidéo', vocal: 'Vocal', note: 'Note', verification: 'Vérification', position: 'Position',
}
const LEGEND = ['photo', 'video', 'vocal', 'note', 'verification', 'position'] as const

export interface MapCapture {
  id: string
  kind: string
  lat: number
  lng: number
  created_at: string
  body: string | null
  reportId: string
  subjectName: string | null
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

export function CaptureMap({ siteId, captures, heightClass = 'h-[70vh]' }: { siteId: string; captures: MapCapture[]; heightClass?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)

      const markers = captures.map((c) => {
        const color = KIND_COLOR[c.kind] ?? '#6b7280'
        const m = L.circleMarker([c.lat, c.lng], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
        const date = new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        const what = escapeHtml(captureWhat(c))
        const excerpt = c.body && !c.subjectName ? '' : (c.body ? `<div style="margin-top:4px">${escapeHtml(c.body.slice(0, 140))}</div>` : '')
        m.bindPopup(
          `<strong>${what}</strong>` +
          `<div style="color:#666;font-size:11px">${KIND_LABEL[c.kind] ?? c.kind} · ${date}</div>${excerpt}` +
          // Consultation → consultation : le récap est la vue DURABLE de la
          // visite. Le Débrief est un outil de production — on n'y tombe pas
          // depuis un point de carte (revue 2026-07-12).
          `<a href="/m/visite/${c.reportId}/recap" style="display:inline-block;margin-top:6px;color:#2563eb">Voir cette visite →</a>`,
        )
        // Étiquette « quoi » visible au survol (desktop) ; le tap ouvre le popup (mobile).
        m.bindTooltip(what, { direction: 'top', opacity: 0.9 })
        m.addTo(map)
        return m
      })

      if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
      else map.setView([0, 0], 2)
    })

    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null }
  }, [captures, siteId])

  return (
    <div className="space-y-2">
      <div ref={ref} className={`${heightClass} w-full overflow-hidden rounded-xl border border-border`} />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: KIND_COLOR[k] }} aria-hidden />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  )
}
