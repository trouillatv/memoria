'use client'

// Saisie de la météo / intempérie du jour pour le journal de chantier.
// Sobre et descriptif (doctrine : pas d'alerte rouge, pas de gamification).
// Le drapeau « intempérie » est la donnée à valeur juridique (preuve datée
// face aux pénalités de retard).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CloudRain } from 'lucide-react'
import { toast } from 'sonner'
import { WEATHER_META, type WeatherCode } from '@/lib/db/site-day-log'
import { recordDayWeatherAction } from './actions'

const WEATHER_ORDER: WeatherCode[] = [
  'clear', 'cloudy', 'rain', 'heavy_rain', 'wind', 'storm', 'heat', 'other',
]

/** Date du jour en fuseau Pacific/Noumea, au format yyyy-mm-dd. */
function todayNoumea(): string {
  const [d, m, y] = new Date()
    .toLocaleDateString('fr-FR', {
      timeZone: 'Pacific/Noumea',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .split('/')
  return `${y}-${m}-${d}`
}

export function DayWeatherForm({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [logDate, setLogDate] = useState(todayNoumea())
  const [weather, setWeather] = useState<WeatherCode | ''>('')
  const [intemperie, setIntemperie] = useState(false)
  const [note, setNote] = useState('')

  function submit() {
    startTransition(async () => {
      const r = await recordDayWeatherAction({
        siteId,
        logDate,
        weather: weather === '' ? null : weather,
        intemperie,
        note: note.trim() || null,
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success('Météo du jour enregistrée')
      setNote('')
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CloudRain className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Météo du jour</h2>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="weather-date" className="text-xs text-muted-foreground">Date</label>
          <input
            id="weather-date"
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            disabled={pending}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="weather-code" className="text-xs text-muted-foreground">Conditions</label>
          <select
            id="weather-code"
            value={weather}
            onChange={(e) => setWeather(e.target.value as WeatherCode | '')}
            disabled={pending}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {WEATHER_ORDER.map((w) => (
              <option key={w} value={w}>{WEATHER_META[w].icon} {WEATHER_META[w].label}</option>
            ))}
          </select>
        </div>

        <label className="inline-flex items-center gap-2 text-sm pb-1.5">
          <input
            type="checkbox"
            checked={intemperie}
            onChange={(e) => setIntemperie(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border"
          />
          Journée empêchée (intervention non réalisable)
        </label>
      </div>

      <div className="space-y-1">
        <label htmlFor="weather-note" className="text-xs text-muted-foreground">
          Note (optionnelle)
        </label>
        <input
          id="weather-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          placeholder="ex. intervention reportée — pluie depuis 6h"
          disabled={pending}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending || (weather === '' && !intemperie && note.trim() === '')}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
