'use client'

// ── CHRONOLOGIE DU GRAPHE (le « film ») ──────────────────────────────────────
// Même modèle que le replay d'Explorer Mémoire : on rejoue l'APPARITION de l'état
// actuel (dates structurelles `since` des relations), on ne reconstruit pas un passé
// disparu. Barre en bas du graphe ; ▶ rejoue du plus ancien jour à aujourd'hui.
// Ne s'affiche que s'il y a au moins deux jours datés (sinon rien à rejouer).

import { useEffect, useRef, useState } from 'react'

const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long' })
const frDay = (iso: string | null) => (iso ? dayFmt.format(new Date(iso)) : null)

// Le parent remonte ce composant (key) quand le graphe change → l'état repart de
// « aujourd'hui » sans effet de reset.
export function GraphTimeline({ days, onChange }: {
  days: string[]
  /** Jour maximum visible, ou null = aujourd'hui (tout). */
  onChange: (timeMax: string | null) => void
}) {
  const [idx, setIdx] = useState<number | null>(null) // null = aujourd'hui
  const playRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (playRef.current) clearTimeout(playRef.current) }, [])

  if (days.length < 2) return null

  const set = (i: number | null) => {
    setIdx(i)
    onChange(i === null || i >= days.length - 1 ? null : days[i]!)
  }
  const play = () => {
    if (playRef.current) clearTimeout(playRef.current)
    let i = 0
    const stepPlay = () => {
      set(i)
      if (i < days.length - 1) { i++; playRef.current = setTimeout(stepPlay, 1100) }
      else playRef.current = setTimeout(() => set(null), 1400)
    }
    stepPlay()
  }

  return (
    <div className="absolute bottom-2 left-2 z-10 w-[min(340px,72%)] rounded-2xl border bg-card/95 px-3.5 py-2 shadow-md backdrop-blur">
      <button type="button" onClick={play} className="text-[12px] font-bold hover:underline">▶ Rejouer l’histoire</button>
      <input
        type="range"
        min={0}
        max={days.length - 1}
        value={idx ?? days.length - 1}
        onChange={(e) => set(+e.target.value)}
        className="w-full accent-brand-600"
        aria-label="Chronologie du réseau"
      />
      <div className="flex justify-between text-[10.5px] text-muted-foreground">
        <span>{frDay(days[0]!)}</span>
        <span className={idx !== null ? 'font-semibold text-foreground' : ''}>
          {idx === null ? "Aujourd’hui" : frDay(days[idx]!)}
        </span>
      </div>
    </div>
  )
}
