'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.5)
//
// Toggle discret entre Vue Site × Jour (primaire) et Vue Équipe × Jour (secondaire).
//
// Doctrine V2 :
//   - Toggle pas 50/50 visuellement : label sobre "Vue : Site ▾" / "Vue : Équipe ▾".
//   - Vue Site est le default. Le passage en team se fait en ajoutant `?view=team`
//     à l'URL. Le retour en site supprime simplement le paramètre.
//   - Pas de persistance localStorage : l'URL est la source de vérité.

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatViewMode, parseViewMode, type WeekViewMode } from './view-mode-storage'

export interface ViewModeToggleProps {
  /** Mode courant (résolu côté serveur). */
  mode: WeekViewMode
}

const LABELS: Record<WeekViewMode, string> = {
  site: 'Vue : Chantier',
  team: 'Vue : Équipe',
}

/**
 * Dropdown natif `<select>` minimaliste pour switcher Site ↔ Équipe.
 *
 * On utilise un `<select>` natif (et non un menu custom) pour :
 *  - simplicité maximale (cohérent avec les FilterSelect existants)
 *  - accessibilité gratuite (clavier, screen reader, mobile)
 *  - rester visuellement discret (pas un bouton call-to-action)
 */
export function ViewModeToggle({ mode }: ViewModeToggleProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = parseViewMode(event.target.value)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    const formatted = formatViewMode(next)
    if (formatted === null) {
      params.delete('view')
    } else {
      params.set('view', formatted)
    }
    const qs = params.toString()
    startTransition(() => {
      router.push(qs.length > 0 ? `/semaine?${qs}` : '/semaine')
    })
  }

  return (
    <label
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1',
        'text-xs text-muted-foreground transition-colors',
        'hover:border-foreground/30 hover:text-foreground',
        pending && 'opacity-60',
      )}
      data-slot="view-mode-toggle"
      data-testid="view-mode-toggle"
    >
      <span className="font-medium">{LABELS[mode]}</span>
      <ChevronDown className="h-3 w-3" aria-hidden="true" />
      <select
        value={mode}
        onChange={handleChange}
        disabled={pending}
        aria-label="Mode de vue de la grille semaine"
        data-testid="view-mode-select"
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        <option value="site">Vue : Chantier</option>
        <option value="team">Vue : Équipe</option>
      </select>
    </label>
  )
}
