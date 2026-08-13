'use client'

import { useEffect, useState } from 'react'

type Metrics = {
  innerWidth: number
  outerWidth: number
  screenWidth: number
  screenAvailWidth: number
  vpWidth: number | null
  vpScale: number | null
  dpr: number
  standalone: boolean
  ua: string
}

export function DiagPanel() {
  const [m, setM] = useState<Metrics | null>(null)

  useEffect(() => {
    setM({
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      screenWidth: screen.width,
      screenAvailWidth: screen.availWidth,
      vpWidth: window.visualViewport?.width ?? null,
      vpScale: window.visualViewport?.scale ?? null,
      dpr: window.devicePixelRatio,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      ua: navigator.userAgent,
    })
  }, [])

  const ok = m && m.innerWidth <= m.screenWidth + 20 && (m.vpScale ?? 1) > 0.9

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 13, background: '#0f172a', color: '#e2e8f0', minHeight: '100dvh' }}>
      <div style={{ marginBottom: 12, fontWeight: 700, fontSize: 15, color: ok ? '#4ade80' : '#f87171' }}>
        Viewport diag {ok ? '✓ OK' : '✗ PROBLÈME'}
      </div>
      {!m ? (
        <div style={{ color: '#94a3b8' }}>Chargement…</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {([
              ['innerWidth', m.innerWidth],
              ['outerWidth', m.outerWidth],
              ['screen.width', m.screenWidth],
              ['screen.availWidth', m.screenAvailWidth],
              ['vp.width', m.vpWidth],
              ['vp.scale', m.vpScale],
              ['devicePixelRatio', m.dpr],
              ['standalone', String(m.standalone)],
            ] as [string, string | number | null][]).map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '6px 8px 6px 0', color: '#94a3b8', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={{ padding: '6px 0', color: '#f1f5f9', fontWeight: 600 }}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m && (
        <div style={{ marginTop: 16, color: '#64748b', fontSize: 11, wordBreak: 'break-all' }}>
          {m.ua}
        </div>
      )}
    </div>
  )
}
