'use client'

// Pastille Plan/Satellite — présentation partagée pour toutes les surfaces
// carte (Terrain, CR plein écran, Corriger l'emplacement). Extrait du lot
// Terrain (2026-08-26) pour éviter trois JSX qui divergent (Vincent,
// lot baseLayer unifié). `variant="card"` = chrome clair (barre de filtres
// Terrain) ; `variant="overlay"` = bandeau sombre plein écran (CR, correction).

import type { MapBaseLayerId } from '@/lib/field/map-base-layers'

export function MapBaseLayerToggle({ baseLayerId, onChange, variant = 'card' }: {
  baseLayerId: MapBaseLayerId
  onChange: (id: MapBaseLayerId) => void
  variant?: 'card' | 'overlay'
}) {
  const isCard = variant === 'card'
  const wrapCls = isCard ? 'rounded-full border border-border bg-card p-0.5' : 'rounded-full bg-white/10 p-0.5'
  const activeCls = isCard ? 'bg-foreground text-background' : 'bg-white text-black'
  const inactiveCls = isCard ? 'text-muted-foreground' : 'text-white/70'

  return (
    <div className={`flex items-center gap-1 ${wrapCls}`}>
      {(['plan', 'satellite'] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={baseLayerId === id}
          className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${baseLayerId === id ? activeCls : inactiveCls}`}
        >
          {id === 'plan' ? 'Plan' : 'Satellite'}
        </button>
      ))}
    </div>
  )
}
