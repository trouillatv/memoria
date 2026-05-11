// Phase 9 — Vue Semaine & Équipes (Slice 9.3)
//
// Page /semaine : Vue Site × Jour primaire (read-only en 9.3).
// Le drag & drop + réassignation arrive en Slice 9.4, et la Vue Équipe ×
// Jour en Slice 9.5.
//
// Doctrine V2 (cf. docs/superpowers/doctrines/planning-doctrine.md V2) :
//   - Vue Site × Jour PRIMAIRE (Équipe × Jour sera secondaire)
//   - Créneaux nommés (m / a / s), JAMAIS d'heures précises
//   - "Non-affecté" = signal ambre discret, JAMAIS rouge
//   - Aucune métrique de performance / charge / saturation / retard
//   - Wording neutre : on organise, on ne surveille pas
//
// Auth : admin OR manager. Belt + suspenders avec le check du layout dashboard.

import { redirect } from 'next/navigation'
import { Calendar, CalendarOff } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  formatWeekParam,
  getWeekBySite,
  parseWeekParam,
  type WeekRange,
} from '@/lib/db/week-planning'
import { EmptyState } from '@/components/ui/empty-state'
import { WeekNavigation } from './WeekNavigation'
import { WeekGrid } from './WeekGrid'
import { CellDrawer } from './CellDrawer'

export const dynamic = 'force-dynamic'

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateShort(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const day = Number(parts[2])
  const month = Number(parts[1])
  const monthName = MONTHS_FR[month - 1] ?? ''
  return `${day} ${monthName}`
}

function formatDateLongWithYear(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  const monthName = MONTHS_FR[month - 1] ?? ''
  return `${day} ${monthName} ${year}`
}

function formatWeekHeader(range: WeekRange): string {
  // « Semaine 20 · du 11 mai au 17 mai 2026 »
  // ou si chevauchement année : « du 30 décembre 2025 au 5 janvier 2026 »
  const startYear = range.weekStart.slice(0, 4)
  const endYear = range.weekEnd.slice(0, 4)
  if (startYear === endYear) {
    return `Semaine ${range.weekNumber} · du ${formatDateShort(
      range.weekStart,
    )} au ${formatDateLongWithYear(range.weekEnd)}`
  }
  return `Semaine ${range.weekNumber} · du ${formatDateLongWithYear(
    range.weekStart,
  )} au ${formatDateLongWithYear(range.weekEnd)}`
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface PageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function SemainePage({ searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const params = await searchParams
  const range = parseWeekParam(params.week)
  const rows = await getWeekBySite(range)
  const todayIso = todayUtcIso()

  const totalInterventions = rows.reduce(
    (acc, r) => acc + Object.values(r.days).reduce((s, d) => s + d.length, 0),
    0,
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Calendar className="h-6 w-6 text-brand-600" />
            {formatWeekHeader(range)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Vue Site &times; Jour. Organisation de la couverture. Aucune métrique de surveillance.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Identifiant semaine&nbsp;: <code className="font-mono">{formatWeekParam(range)}</code>
          </p>
        </div>
        <WeekNavigation range={range} />
      </header>

      {rows.length === 0 || totalInterventions === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={CalendarOff}
            title="Aucune mission planifiée cette semaine"
            description="Rien à organiser pour le moment. Naviguez vers une autre semaine ou créez une mission depuis la page Missions."
            variant="compact"
          />
        </div>
      ) : (
        <CellDrawer rows={rows}>
          <WeekGrid range={range} rows={rows} todayIso={todayIso} />
        </CellDrawer>
      )}
    </div>
  )
}
