'use client'

// TEMPORAIRE — panneau de diagnostic viewport. À supprimer après recette.
// Visible uniquement quand l'URL contient ?diag=1.

import { useEffect, useState } from 'react'

interface DiagData {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  clientWidth: number
  screenWidth: number
  screenAvailWidth: number
  devicePixelRatio: number
  visualViewportWidth: number | null
  visualViewportScale: number | null
  isStandalone: boolean
  userAgent: string
  viewportMetaCount: number
  viewportMetaContents: string[]
  manifestHref: string | null
  mainBoundingWidth: number | null
  navBoundingWidth: number | null
}

function collect(): DiagData {
  const vv = window.visualViewport
  const metas = Array.from(document.querySelectorAll('meta[name="viewport"]'))
  const mainEl = document.querySelector('main')
  const navEl = document.querySelector('nav')

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    clientWidth: document.documentElement.clientWidth,
    screenWidth: screen.width,
    screenAvailWidth: screen.availWidth,
    devicePixelRatio: window.devicePixelRatio,
    visualViewportWidth: vv?.width ?? null,
    visualViewportScale: vv?.scale ?? null,
    isStandalone: window.matchMedia('(display-mode: standalone)').matches,
    userAgent: navigator.userAgent,
    viewportMetaCount: metas.length,
    viewportMetaContents: metas.map((m) => m.getAttribute('content') ?? ''),
    manifestHref: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? null,
    mainBoundingWidth: mainEl ? Math.round(mainEl.getBoundingClientRect().width) : null,
    navBoundingWidth: navEl ? Math.round(navEl.getBoundingClientRect().width) : null,
  }
}

export function ViewportDiagnostic() {
  const [data, setData] = useState<DiagData | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('diag') !== '1') return
    setData(collect())
  }, [])

  if (!data) return null

  const warn = data.innerWidth > 500 ? '⚠️ ' : ''
  const metaOk = data.viewportMetaCount === 1 && data.viewportMetaContents[0]?.includes('device-width')

  const rows: [string, string, boolean?][] = [
    ['window.innerWidth', `${warn}${data.innerWidth}`, data.innerWidth > 500],
    ['window.outerWidth', String(data.outerWidth)],
    ['documentElement.clientWidth', String(data.clientWidth)],
    ['screen.width', String(data.screenWidth)],
    ['screen.availWidth', String(data.screenAvailWidth)],
    ['devicePixelRatio', String(data.devicePixelRatio)],
    ['visualViewport.width', data.visualViewportWidth !== null ? String(Math.round(data.visualViewportWidth)) : 'n/a'],
    ['visualViewport.scale', data.visualViewportScale !== null ? String(data.visualViewportScale) : 'n/a'],
    ['display-mode standalone', String(data.isStandalone)],
    ['viewport meta count', `${data.viewportMetaCount}${data.viewportMetaCount !== 1 ? ' ⚠️' : ''}`],
    ...data.viewportMetaContents.map((c, i): [string, string, boolean?] => [
      `  meta[${i}] content`, c || '(vide)', !metaOk,
    ]),
    ['manifest <link> href', data.manifestHref ? data.manifestHref.replace(window.location.origin, '') : 'ABSENT'],
    ['<main> bounding width', data.mainBoundingWidth !== null ? String(data.mainBoundingWidth) : 'n/a'],
    ['<nav> bounding width', data.navBoundingWidth !== null ? String(data.navBoundingWidth) : 'n/a'],
  ]

  return (
    <div className="fixed bottom-24 left-2 right-2 z-[9999] rounded-xl bg-black/90 p-3 font-mono text-[10px] text-white shadow-2xl overflow-auto max-h-[55vh]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-yellow-400">DIAG VIEWPORT — TEMP</span>
        <button
          className="text-white/50 underline text-[10px]"
          onClick={() => setData(collect())}
        >
          ↻
        </button>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          {rows.map(([k, v, isWarn]) => (
            <tr key={k} className="border-b border-white/10">
              <td className="py-0.5 pr-2 text-white/50 align-top whitespace-nowrap">{k}</td>
              <td className={`py-0.5 break-all ${isWarn ? 'text-red-400 font-bold' : 'text-yellow-300'}`}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-white/40 text-[9px] break-all">UA: {data.userAgent}</p>
    </div>
  )
}
