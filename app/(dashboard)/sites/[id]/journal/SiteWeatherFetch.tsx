'use client'

// Récupération météo Open-Meteo (commit 2). Bouton « Récupérer météo du jour » ;
// si le chantier n'a pas de coordonnées, on les demande (saisie manuelle +
// localisation best-effort via l'adresse). La météo enrichit site_day_log —
// elle ne crée JAMAIS un blocage (cf. doctrine). L'intempérie reste humaine.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CloudDownload, MapPin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { WEATHER_META, type WeatherCode } from '@/lib/db/site-day-log-meta'
import {
  fetchSiteWeatherAction,
  geocodeSiteAction,
  setSiteCoordinatesAction,
} from './actions'

function todayNoumea(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Noumea' })
}

// Saisie par LOCALITÉ (Grand Nouméa, Nouvelle-Calédonie) plutôt que par
// coordonnées brutes. Nouméa par défaut. Les coordonnées restent ajustables à la
// main pour un point précis ; « Localiser via l'adresse » affine si besoin.
const NC_LOCALITIES: Array<{ name: string; lat: string; lon: string }> = [
  { name: 'Nouméa – Centre', lat: '-22.27580', lon: '166.45800' },
  { name: 'Nouméa – Centre-ville', lat: '-22.27100', lon: '166.44160' },
  { name: 'Nouméa – Ducos', lat: '-22.24700', lon: '166.43600' },
  { name: 'Nouméa – Magenta', lat: '-22.26400', lon: '166.47300' },
  { name: 'Nouméa – Rivière-Salée', lat: '-22.23500', lon: '166.45600' },
  { name: 'Nouméa – Anse Vata', lat: '-22.30500', lon: '166.44300' },
  { name: 'Dumbéa', lat: '-22.15250', lon: '166.45200' },
  { name: 'Mont-Dore', lat: '-22.20800', lon: '166.57200' },
  { name: 'Païta', lat: '-22.13000', lon: '166.35000' },
]
const NOUMEA = NC_LOCALITIES[0]

export function SiteWeatherFetch({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [date, setDate] = useState(todayNoumea())
  const [pending, start] = useTransition()
  const [needCoords, setNeedCoords] = useState(false)
  const [lat, setLat] = useState(NOUMEA.lat)
  const [lon, setLon] = useState(NOUMEA.lon)

  function describe(weather: WeatherCode | null, precip: number | null, wind: number | null, tmax: number | null): string {
    const parts: string[] = []
    if (weather) parts.push(`${WEATHER_META[weather].icon} ${WEATHER_META[weather].label}`)
    if (precip != null && precip > 0) parts.push(`${Math.round(precip)} mm`)
    if (wind != null && wind >= 30) parts.push(`vent ${Math.round(wind)} km/h`)
    if (tmax != null && tmax >= 33) parts.push(`${Math.round(tmax)} °C`)
    return parts.join(' · ') || 'météo enregistrée'
  }

  function fetchWeather() {
    start(async () => {
      const r = await fetchSiteWeatherAction(siteId, date)
      if ('error' in r) {
        if (r.needCoords) {
          setNeedCoords(true)
          toast.info('Renseignez les coordonnées du chantier pour la météo.')
        } else {
          toast.error(r.error)
        }
        return
      }
      const label = describe(r.weather, r.precipitationMm, r.windMaxKmh, r.tempMax)
      toast.success(r.cached ? `Météo (déjà en cache) : ${label}` : `Météo récupérée : ${label}`)
      if (r.intemperieSuggeree) {
        toast.warning('Conditions d’intempérie probables — cochez « Journée empêchée » si c’est le cas.')
      }
      router.refresh()
    })
  }

  function geolocate() {
    start(async () => {
      const r = await geocodeSiteAction(siteId)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      setLat(r.latitude.toFixed(5))
      setLon(r.longitude.toFixed(5))
      toast.success(`Trouvé : ${r.label} — vérifiez puis enregistrez.`)
    })
  }

  function saveCoords() {
    const la = Number(lat)
    const lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      toast.error('Latitude / longitude invalides.')
      return
    }
    start(async () => {
      const r = await setSiteCoordinatesAction(siteId, la, lo)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      setNeedCoords(false)
      toast.success('Coordonnées enregistrées.')
      // Enchaîne directement sur la récupération météo.
      const w = await fetchSiteWeatherAction(siteId, date)
      if ('ok' in w) {
        toast.success(`Météo récupérée : ${describe(w.weather, w.precipitationMm, w.windMaxKmh, w.tempMax)}`)
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CloudDownload className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">Météo automatique (Open-Meteo)</h2>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="om-date" className="text-xs text-muted-foreground">Date</label>
          <input
            id="om-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={fetchWeather}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
          Récupérer météo du jour
        </button>
      </div>

      {needCoords && (
        <div className="rounded-md border border-dashed p-3 space-y-2">
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> Localité du chantier (une seule fois)
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <select
              defaultValue={NOUMEA.name}
              onChange={(e) => {
                const loc = NC_LOCALITIES.find((l) => l.name === e.target.value)
                if (loc) { setLat(loc.lat); setLon(loc.lon) }
              }}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {NC_LOCALITIES.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" title="Coordonnée fine (optionnel)" className="w-28 rounded border px-2 py-1 text-sm" />
            <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude" title="Coordonnée fine (optionnel)" className="w-28 rounded border px-2 py-1 text-sm" />
            <button type="button" onClick={geolocate} disabled={pending} className="rounded border px-2.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-50">
              Localiser via l’adresse
            </button>
            <button type="button" onClick={saveCoords} disabled={pending} className="rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50">
              Enregistrer & récupérer
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        La météo documente le journal et les blocages ; elle ne crée jamais un blocage toute seule.
      </p>
    </div>
  )
}
