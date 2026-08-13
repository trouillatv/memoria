'use client'

import { useEffect, useRef, useState } from 'react'

type NodeMetrics = {
  label: string
  rectWidth: number
  maxWidth: string
  transform: string
  zoom: string
  fontSize: string
}

type Report = {
  innerWidth: number
  screenWidth: number
  clientWidth: number
  vpWidth: number | null
  vpScale: number | null
  displayMode: string
  metaViewport: string
  uaDataMobile: string
  orientation: string
  ua: string
  chain: NodeMetrics[]
}

function measure(el: Element, label: string): NodeMetrics {
  const cs = getComputedStyle(el)
  return {
    label,
    rectWidth: Math.round(el.getBoundingClientRect().width * 10) / 10,
    maxWidth: cs.maxWidth,
    transform: cs.transform,
    zoom: (cs as CSSStyleDeclaration & { zoom?: string }).zoom ?? '1',
    fontSize: cs.fontSize,
  }
}

function detectDisplayMode(): string {
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'browser']) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode
  }
  return 'unknown'
}

export function DiagPanelV2() {
  const ref = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<Report | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chain: NodeMetrics[] = []
    let el: Element | null = ref.current
    while (el) {
      const tag = el.tagName.toLowerCase()
      const cls = (el.className && typeof el.className === 'string')
        ? el.className.split(' ').filter(c => /max-w|min-h|mx-auto|w-|px-|scale|container/.test(c)).slice(0, 4).join(' ')
        : ''
      chain.push(measure(el, `${tag}${cls ? ` .${cls}` : ''}`))
      el = el.parentElement
    }
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
    setReport({
      innerWidth: window.innerWidth,
      screenWidth: screen.width,
      clientWidth: document.documentElement.clientWidth,
      vpWidth: window.visualViewport ? Math.round(window.visualViewport.width * 10) / 10 : null,
      vpScale: window.visualViewport?.scale ?? null,
      displayMode: detectDisplayMode(),
      metaViewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '(absent)',
      uaDataMobile: nav.userAgentData?.mobile === undefined ? 'n/a' : String(nav.userAgentData.mobile),
      orientation: screen.orientation?.type ?? 'n/a',
      ua: navigator.userAgent,
      chain: chain.reverse(),
    })
  }, [])

  // Le vrai critère : viewport layout vs écran physique. innerWidth ~980 sur un
  // écran de ~412 = Chrome fournit un viewport desktop à la PWA.
  const broken = report ? report.innerWidth > report.screenWidth + 30 : false

  return (
    <div ref={ref} style={{ padding: 12, fontFamily: 'monospace', fontSize: 11, background: '#0f172a', color: '#e2e8f0', minHeight: '100dvh' }}>
      <div style={{ marginBottom: 10, fontWeight: 700, fontSize: 14, color: broken ? '#f87171' : '#4ade80' }}>
        {report ? (broken ? `✗ VIEWPORT DESKTOP (${report.innerWidth} sur écran ${report.screenWidth})` : '✓ viewport mobile sain') : '…'}
      </div>
      {report && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 12 }}>
            <tbody>
              {([
                ['innerWidth', report.innerWidth],
                ['screen.width', report.screenWidth],
                ['docElement.clientWidth', report.clientWidth],
                ['visualViewport.width', report.vpWidth],
                ['visualViewport.scale', report.vpScale],
                ['display-mode', report.displayMode],
                ['uaData.mobile', report.uaDataMobile],
                ['orientation', report.orientation],
              ] as [string, string | number | null][]).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '4px 8px 4px 0', color: '#94a3b8', whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ padding: '4px 0', color: '#f1f5f9', fontWeight: 600 }}>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginBottom: 4, color: '#64748b' }}>meta viewport :</div>
          <div style={{ marginBottom: 12, color: '#cbd5e1', wordBreak: 'break-all' }}>{report.metaViewport}</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px 4px 0' }}>élément</th>
                <th style={{ padding: '4px 6px' }}>rect</th>
                <th style={{ padding: '4px 6px' }}>max-w</th>
                <th style={{ padding: '4px 0' }}>font</th>
              </tr>
            </thead>
            <tbody>
              {report.chain.map((n, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b', verticalAlign: 'top' }}>
                  <td style={{ padding: '5px 6px 5px 0', color: '#cbd5e1', wordBreak: 'break-all' }}>{n.label}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700 }}>{n.rectWidth}</td>
                  <td style={{ padding: '5px 6px', color: '#94a3b8' }}>{n.maxWidth}</td>
                  <td style={{ padding: '5px 0', color: '#94a3b8' }}>
                    {n.transform !== 'none' && n.transform !== 'matrix(1, 0, 0, 1, 0, 0)' ? `${n.transform} ` : ''}{n.zoom !== '1' ? `zoom:${n.zoom} ` : ''}{n.fontSize}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, color: '#64748b', fontSize: 10, wordBreak: 'break-all' }}>{report.ua}</div>
        </>
      )}
    </div>
  )
}
