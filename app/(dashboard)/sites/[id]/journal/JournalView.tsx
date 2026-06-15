import Link from 'next/link'
import {
  Camera,
  AlertTriangle,
  CheckCircle2,
  Users,
  Building2,
  FileText,
} from 'lucide-react'
import type { JournalEntry, JournalIntervention } from '@/lib/db/site-journal'
import { WEATHER_META } from '@/lib/db/site-day-log-meta'

// ---------------------------------------------------------------------------
// Formatage des dates
// ---------------------------------------------------------------------------

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function formatDayHeading(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dayName = FR_DAYS[utc.getUTCDay()]
  return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${d} ${FR_MONTHS[m - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Badge statut
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  completed: 'Exécutée',
  validated: 'Validée',
  in_progress: 'En cours',
  skipped: 'Sautée',
  planned: 'Planifiée',
}

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  validated: 'bg-sky-100 text-sky-900 border-sky-300',
  in_progress: 'bg-amber-100 text-amber-900 border-amber-300',
  skipped: 'bg-muted text-muted-foreground border-border',
  planned: 'bg-muted text-muted-foreground border-border',
}

// ---------------------------------------------------------------------------
// Team color helper (très pâle)
// ---------------------------------------------------------------------------

function hexToVeryPale(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * 0.1 + 255 * 0.9)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

// ---------------------------------------------------------------------------
// Composants
// ---------------------------------------------------------------------------

function InterventionCard({ entry }: { entry: JournalIntervention }) {
  const statusLabel = STATUS_LABEL[entry.status] ?? entry.status
  const statusClass = STATUS_CLASS[entry.status] ?? STATUS_CLASS.planned

  return (
    <Link
      href={`/interventions/${entry.id}`}
      className="block rounded-lg border bg-card hover:bg-muted/20 transition-colors p-4 space-y-2.5"
    >
      {/* Ligne titre */}
      <div className="flex items-center gap-2 flex-wrap">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
        <span className="font-medium text-sm">{entry.missionName}</span>
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Chips info */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {/* Équipe */}
        {entry.teamName && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
            style={{
              backgroundColor: hexToVeryPale(entry.teamColor),
              borderColor: entry.teamColor ?? undefined,
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.teamColor ?? '#94a3b8' }}
              aria-hidden
            />
            <span className="text-foreground font-medium">{entry.teamName}</span>
          </span>
        )}

        {/* Participants */}
        {entry.participantCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {entry.participantCount} participant{entry.participantCount > 1 ? 's' : ''}
          </span>
        )}

        {/* Photos */}
        {entry.photoCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Camera className="h-3 w-3" aria-hidden />
            {entry.photoCount} photo{entry.photoCount > 1 ? 's' : ''}
          </span>
        )}

        {/* Anomalies ouvertes */}
        {entry.anomaliesOpen > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {entry.anomaliesOpen} anomalie{entry.anomaliesOpen > 1 ? 's' : ''}
          </span>
        )}

        {/* Anomalies résolues */}
        {entry.anomaliesResolved > 0 && entry.anomaliesOpen === 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {entry.anomaliesResolved} résolue{entry.anomaliesResolved > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Entreprises externes */}
      {entry.companies.length > 0 && (
        <div className="flex items-start gap-1.5 flex-wrap text-xs text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
          {entry.companies.map((c, i) => (
            <span key={c.id}>
              <span className="font-medium text-foreground">{c.company_name}</span>
              {c.role_description && (
                <span className="text-muted-foreground"> ({c.role_description})</span>
              )}
              {i < entry.companies.length - 1 && <span>,</span>}
            </span>
          ))}
        </div>
      )}

      {/* Note terrain */}
      {entry.notes && (
        <p className="text-sm text-foreground/80 italic border-l-2 border-muted pl-3">
          {entry.notes}
        </p>
      )}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

interface Props {
  entries: JournalEntry[]
}

export function JournalView({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        Aucune intervention enregistrée sur ce site pour le moment.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {entries.map((entry) => {
        const weatherMeta = entry.weather ? WEATHER_META[entry.weather] : null
        return (
        <div key={entry.date} className="space-y-3">
          {/* En-tête de jour */}
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {formatDayHeading(entry.date)}
            </h2>
            <div className="flex-1 h-px bg-border/50" aria-hidden />
            {/* Météo / intempérie du jour (sobre, jamais rouge) */}
            {entry.intemperie && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 shrink-0">
                🌧️ Journée empêchée
              </span>
            )}
            {weatherMeta && !entry.intemperie && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground shrink-0">
                <span aria-hidden>{weatherMeta.icon}</span> {weatherMeta.label}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {entry.interventions.length} intervention{entry.interventions.length > 1 ? 's' : ''}
            </span>
          </div>

          {/* Note météo du jour */}
          {entry.weatherNote && (
            <p className="text-xs italic text-muted-foreground">{entry.weatherNote}</p>
          )}

          {/* Cartes interventions, ou mention si journée sans intervention */}
          {entry.interventions.length === 0 ? (
            <p className="text-xs text-muted-foreground/80 italic">
              Aucune intervention ce jour.
            </p>
          ) : (
            <div className="space-y-2">
              {entry.interventions.map((intv) => (
                <InterventionCard key={intv.id} entry={intv} />
              ))}
            </div>
          )}
        </div>
        )
      })}
    </div>
  )
}
