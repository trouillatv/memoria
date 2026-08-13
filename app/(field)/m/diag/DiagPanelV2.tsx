'use client'

import { useEffect, useRef, useState } from 'react'

type NodeMetrics = {
  label: string
  rectWidth: number
  cssWidth: string
  maxWidth: string
  minWidth: string
  transform: string
  zoom: string
  fontSize: string
}

type Report = {
  innerWidth: number
  screenWidth: number
  vpScale: number | null
  standalone: boolean
  chain: NodeMetrics[]
}

function measure(el: Element, label: string): NodeMetrics {
  const cs = getComputedStyle(el)
  return {
    label,
    rectWidth: Math.round(el.getBoundingClientRect().width * 10) / 10,
    cssWidth: cs.width,
    maxWidth: cs.maxWidth,
    minWidth: cs.minWidth,
    transform: cs.transform,
    zoom: (cs as CSSStyleDeclaration & { zoom?: string }).zoom ?? '1',
    fontSize: cs.fontSize,
  }
}

export function DiagPanelV2() {
  const ref = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<Report | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chain: NodeMetrics[] = []
    // Remonter du panneau jusqu'à <html> : chaque parent est mesuré tel que rendu.
    let el: Element | null = ref.current
    while (el) {
      const tag = el.tagName.toLowerCase()
      const cls = (el.className && typeof el.className === 'string')
        ? el.className.split(' ').filter(c => /max-w|min-h|mx-auto|w-|px-|scale|container/.test(c)).slice(0, 4).join(' ')
        : ''
      chain.push(measure(el, `${tag}${cls ? ` .${cls}` : ''}`))
      el = el.parentElement
    }
    setReport({
      innerWidth: window.innerWidth,
      screenWidth: screen.width,
      vpScale: window.visualViewport?.scale ?? null,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      chain: chain.reverse(), // html en premier, panneau en dernier
    })
  }, [])

  // Critère : chaque niveau doit être ≈ innerWidth (moins les paddings).
  const suspect = report?.chain.find(n =>
    n.rectWidth > report.innerWidth + 30 ||
    (n.transform !== 'none' && n.transform !== '') && n.transform !== 'matrix(1, 0, 0, 1, 0, 0)'
  )

  return (
    <div ref={ref} style={{ padding: 12, fontFamily: 'monospace', fontSize: 11, background: '#0f172a', color: '#e2e8f0', minHeight: '100dvh' }}>
      <div style={{ marginBottom: 10, fontWeight: 700, fontSize: 14, color: suspect ? '#f87171' : '#4ade80' }}>
        Layout diag {report ? (suspect ? `✗ SUSPECT: ${suspect.label}` : '✓ hiérarchie saine') : '…'}
      </div>
      {report && (
        <>
          <div style={{ marginBottom: 10, color: '#94a3b8' }}>
            innerWidth {report.innerWidth} · screen {report.screenWidth} · scale {report.vpScale} · standalone {String(report.standalone)}
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px 4px 0' }}>élément</th>
                <th style={{ padding: '4px 6px' }}>rect</th>
                <th style={{ padding: '4px 6px' }}>max-w</th>
                <th style={{ padding: '4px 0' }}>transform/font</th>
              </tr>
            </thead>
            <tbody>
              {report.chain.map((n, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b', verticalAlign: 'top' }}>
                  <td style={{ padding: '5px 6px 5px 0', color: '#cbd5e1', wordBreak: 'break-all' }}>{n.label}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, color: n.rectWidth > report.innerWidth + 30 ? '#f87171' : '#f1f5f9' }}>{n.rectWidth}</td>
                  <td style={{ padding: '5px 6px', color: '#94a3b8' }}>{n.maxWidth}</td>
                  <td style={{ padding: '5px 0', color: '#94a3b8' }}>
                    {n.transform !== 'none' ? n.transform : ''} {n.zoom !== '1' ? `zoom:${n.zoom}` : ''} {n.fontSize}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
