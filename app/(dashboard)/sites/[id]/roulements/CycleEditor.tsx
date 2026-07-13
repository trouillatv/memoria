'use client'

// PL5a — LA GRILLE. C'est sa feuille, à l'écran.
//
// Lignes = les équipes (une équipe d'une personne s'affiche par son nom — c'est
// ainsi que le produit parle des gens sans jamais les planifier nominativement :
// les écritures restent sur `team_id`).
// Colonnes = les jours. Cases = Travail / Repos, au clic.
//
// Le REPOS est un ÉTAT, pas une absence : sa feuille est faite pour LIRE LES
// REPOS. Il se voit, il se stocke — il ne génère simplement aucune intervention.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X, CalendarRange } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { todayLocalIso } from '@/lib/time/local-date'
import { saveCycleAction } from './actions'

const DAYS = [
  { iso: 1, label: 'Lun' },
  { iso: 2, label: 'Mar' },
  { iso: 3, label: 'Mer' },
  { iso: 4, label: 'Jeu' },
  { iso: 5, label: 'Ven' },
  { iso: 6, label: 'Sam' },
  { iso: 7, label: 'Dim' },
] as const

const WEEK_NAMES = ['Semaine A', 'Semaine B', 'Semaine C', 'Semaine D']

export interface TeamOption {
  id: string
  /** Le nom affiché — celui du membre si l'équipe n'en a qu'un. */
  label: string
}

export interface MissionOption {
  id: string
  name: string
}

export interface InitialCycle {
  id: string
  missionId: string
  name: string
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  slots: Array<{
    weekIndex: number
    weekday: number
    teamId: string
    state: 'work' | 'rest'
    startTime: string | null
    endTime: string | null
  }>
}

/** Clé d'une case : (semaine, jour, équipe). */
const key = (w: number, d: number, t: string) => `${w}|${d}|${t}`

/** Le lundi de la semaine d'une date (ISO). L'ancrage est toujours un lundi :
 *  sinon « la semaine A » ne voudrait rien dire. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

export function CycleEditor({
  siteId,
  missions,
  teams,
  initial,
}: {
  siteId: string
  missions: MissionOption[]
  teams: TeamOption[]
  initial?: InitialCycle
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [name, setName] = useState(initial?.name ?? '')
  const [missionId, setMissionId] = useState(initial?.missionId ?? missions[0]?.id ?? '')
  const [weeks, setWeeks] = useState(initial?.cycleLengthWeeks ?? 1)
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? todayLocalIso())
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? '')
  const [startTime, setStartTime] = useState(
    initial?.slots.find((s) => s.startTime)?.startTime ?? '06:00',
  )
  const [endTime, setEndTime] = useState(initial?.slots.find((s) => s.endTime)?.endTime ?? '09:00')

  // Les équipes de la grille — dans l'ordre où Guillaume les a ajoutées.
  const [rows, setRows] = useState<string[]>(() => {
    const fromInitial = [...new Set(initial?.slots.map((s) => s.teamId) ?? [])]
    return fromInitial.length > 0 ? fromInitial : teams[0] ? [teams[0].id] : []
  })

  // Les cases TRAVAILLÉES. Le repos est l'absence dans ce Set — mais il est bien
  // écrit en base (voir `slots` à l'enregistrement).
  const [worked, setWorked] = useState<Set<string>>(
    () => new Set((initial?.slots ?? []).filter((s) => s.state === 'work').map((s) => key(s.weekIndex, s.weekday, s.teamId))),
  )

  const available = useMemo(() => teams.filter((t) => !rows.includes(t.id)), [teams, rows])
  const labelOf = (id: string) => teams.find((t) => t.id === id)?.label ?? 'Équipe'

  function toggle(w: number, d: number, t: string) {
    const k = key(w, d, t)
    setWorked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function save() {
    if (pending) return
    if (!name.trim()) return toast.error('Donnez un nom au roulement')
    if (!missionId) return toast.error('Choisissez la mission')
    if (rows.length === 0) return toast.error('Ajoutez au moins une équipe')

    // Toutes les cases sont écrites — travail ET repos. Sa feuille se relit
    // telle qu'il l'a dessinée.
    const slots = rows.flatMap((teamId) =>
      Array.from({ length: weeks }, (_, w) =>
        DAYS.map((day) => {
          const isWork = worked.has(key(w, day.iso, teamId))
          return {
            weekIndex: w,
            weekday: day.iso,
            teamId,
            state: isWork ? ('work' as const) : ('rest' as const),
            startTime: isWork ? startTime : null,
            endTime: isWork ? endTime : null,
          }
        }),
      ).flat(),
    )

    start(async () => {
      const r = await saveCycleAction({
        ...(initial ? { cycleId: initial.id } : {}),
        siteId,
        missionId,
        name: name.trim(),
        cycleLengthWeeks: weeks,
        // L'ancrage est le lundi de la date de début : c'est lui qui définit
        // « la semaine A ».
        anchorDate: mondayOf(startsOn),
        startsOn,
        endsOn: endsOn || null,
        slots,
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(initial ? 'Roulement modifié' : 'Roulement enregistré')
      router.push(`/sites/${siteId}/roulements`)
      router.refresh()
    })
  }

  const workedCount = worked.size

  return (
    <div className="space-y-5">
      {/* Identité du roulement */}
      <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Nom du roulement</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="ex : Roulement magasin"
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Quelle prestation ?</span>
          <select
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
            disabled={pending || missions.length === 0}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {missions.length === 0 && <option value="">Aucune mission sur ce chantier</option>}
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Le roulement dure</legend>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                disabled={pending}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  weeks === w ? 'border-brand-500 bg-brand-50 font-medium' : 'bg-background hover:bg-muted'
                }`}
              >
                {w} semaine{w > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Horaire habituel</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">&nbsp;</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      </section>

      {/* LA GRILLE — sa feuille */}
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {WEEK_NAMES[w]}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-40 px-2 py-1 text-left text-[11px] font-medium text-muted-foreground">
                      Équipe
                    </th>
                    {DAYS.map((d) => (
                      <th
                        key={d.iso}
                        className="px-1 py-1 text-center text-[11px] font-medium text-muted-foreground"
                      >
                        {d.label}
                      </th>
                    ))}
                    {/* Sa feuille TOTALISE : 9 jours, 23, 22… c'est ce qu'il lit. */}
                    <th className="w-12 px-1 py-1 text-center text-[11px] font-medium text-muted-foreground">
                      Jours
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((teamId) => (
                    <tr key={teamId} className="border-t">
                      <th scope="row" className="px-2 py-1.5 text-left text-sm font-medium">
                        <span className="flex items-center justify-between gap-1">
                          <span className="truncate">{labelOf(teamId)}</span>
                          {w === 0 && (
                            <button
                              type="button"
                              onClick={() => setRows((r) => r.filter((x) => x !== teamId))}
                              disabled={pending}
                              aria-label={`Retirer ${labelOf(teamId)}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </th>
                      {DAYS.map((d) => {
                        const isWork = worked.has(key(w, d.iso, teamId))
                        return (
                          <td key={d.iso} className="p-0.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggle(w, d.iso, teamId)}
                              disabled={pending}
                              aria-pressed={isWork}
                              aria-label={`${labelOf(teamId)}, ${d.label} ${WEEK_NAMES[w]} : ${isWork ? 'travail' : 'repos'}`}
                              data-state={isWork ? 'work' : 'rest'}
                              className={`h-9 w-full rounded-md border text-[11px] font-medium transition-colors ${
                                isWork
                                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                  : 'border-amber-200 bg-amber-50/70 text-amber-700/80 hover:bg-amber-100'
                              }`}
                            >
                              {isWork ? 'Travail' : 'Repos'}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-1 text-center text-xs font-medium tabular-nums text-muted-foreground">
                        {DAYS.filter((d) => worked.has(key(w, d.iso, teamId))).length}
                      </td>
                    </tr>
                  ))}
                  {/* La COUVERTURE : combien de personnes ce jour-là ? Un jour à
                      zéro est ce qu'il cherche du regard sur sa feuille. */}
                  {rows.length > 0 && (
                    <tr className="border-t bg-muted/30">
                      <th scope="row" className="px-2 py-1 text-left text-[11px] font-medium text-muted-foreground">
                        Présents
                      </th>
                      {DAYS.map((d) => {
                        const n = rows.filter((t) => worked.has(key(w, d.iso, t))).length
                        return (
                          <td
                            key={d.iso}
                            className={`px-1 py-1 text-center text-xs font-semibold tabular-nums ${
                              n === 0 ? 'text-rose-600' : 'text-muted-foreground'
                            }`}
                            title={n === 0 ? 'Personne ce jour-là' : `${n} personne${n > 1 ? 's' : ''}`}
                          >
                            {n === 0 ? '—' : n}
                          </td>
                        )
                      })}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ajoutez au moins une équipe pour dessiner le roulement.
          </p>
        )}

        {available.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Ajouter :</span>
            {available.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRows((r) => [...r, t.id])}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-xs hover:bg-muted"
              >
                <Plus className="h-3 w-3" /> {t.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Période */}
      <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" /> À partir du
          </span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <span className="block text-[11px] text-muted-foreground">
            La semaine du {startsOn || '…'} est la « Semaine A ».
          </span>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Jusqu&apos;au</span>
          <input
            type="date"
            value={endsOn}
            min={startsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <span className="block text-[11px] text-muted-foreground">
            Laisser vide pour un roulement sans fin.
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || rows.length === 0 || missions.length === 0}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {initial ? 'Enregistrer les modifications' : 'Enregistrer le roulement'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {workedCount === 0
            ? 'Aucun jour travaillé pour l’instant.'
            : `${workedCount} jour${workedCount > 1 ? 's' : ''} travaillé${workedCount > 1 ? 's' : ''} sur le cycle.`}
        </p>
      </div>
    </div>
  )
}
