'use client'

// Champ horaire maîtrisé (deux sélecteurs heures / minutes) — remplace
// `<input type="time">` dont le PICKER NATIF Android débordait du cadre
// (boutons « Effacer / Annuler / Définir » rognés, non corrigeable en CSS car
// rendu par l'OS). Les <select> natifs s'ouvrent en liste plein écran et ne
// débordent jamais ; le composant est entièrement contrôlé par nous.
//
// Drop-in : `value`/`onChange` en "HH:MM" (ou "" si incomplet), comme avant.
// Le <select> des heures porte l'`id` pour conserver l'association d'un
// éventuel <label htmlFor>. Le slot DB reste dérivé côté serveur, inchangé.

import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')
const TIME_RE = /^(\d{1,2}):(\d{2})$/

interface TimeFieldProps {
  /** Valeur "HH:MM" ou "" si non saisie. */
  value: string
  /** Reçoit "HH:MM" complet, ou "" si l'heure est effacée. */
  onChange: (value: string) => void
  /** Pas des minutes (défaut 5). */
  step?: number
  disabled?: boolean
  /** Appliqué au <select> heures pour associer un <label htmlFor> externe. */
  id?: string
  /** Nom accessible de base — sert d'aria-label aux deux sélecteurs. */
  label?: string
  className?: string
}

export function TimeField({
  value,
  onChange,
  step = 5,
  disabled,
  id,
  label,
  className,
}: TimeFieldProps) {
  const m = TIME_RE.exec(value ?? '')
  const hour = m ? pad(Number(m[1])) : ''
  const minute = m ? m[2] : ''

  const hours = Array.from({ length: 24 }, (_, i) => pad(i))
  const stepSafe = step > 0 && step < 60 ? step : 5
  const grid = Array.from({ length: Math.ceil(60 / stepSafe) }, (_, i) => pad(i * stepSafe))
  // Garantit que la minute préchargée (ex. "32" hors pas) reste sélectionnable.
  const minutes = minute && !grid.includes(minute) ? [...grid, minute].sort() : grid

  const sel = cn(
    'rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
    className,
  )

  return (
    <div className="flex items-center gap-1.5">
      <select
        id={id}
        aria-label={id ? undefined : label ? `${label} — heures` : 'Heures'}
        className={sel}
        value={hour}
        disabled={disabled}
        onChange={(e) => {
          const h = e.target.value
          onChange(h ? `${h}:${minute || '00'}` : '')
        }}
      >
        <option value="">--</option>
        {hours.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span aria-hidden className="text-sm text-muted-foreground">h</span>
      <select
        aria-label={label ? `${label} — minutes` : 'Minutes'}
        className={sel}
        value={minute}
        disabled={disabled || !hour}
        onChange={(e) => {
          const mm = e.target.value
          onChange(hour ? `${hour}:${mm || '00'}` : '')
        }}
      >
        <option value="">--</option>
        {minutes.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
    </div>
  )
}
