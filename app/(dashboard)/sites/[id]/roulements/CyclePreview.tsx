'use client'

// PL5b — « Voilà à quoi ressemblera votre mois. »
//
// L'aperçu ne matérialise RIEN : il affiche ce que le moteur de projection
// calcule, sans qu'une seule ligne n'existe encore en base. C'est le moment où
// Guillaume compare l'écran à sa feuille — et corrige AVANT de publier.
//
// Il regarde quatre choses, dans cet ordre :
//   1. qui travaille chaque jour ;
//   2. y a-t-il au moins une personne (le trou saute aux yeux) ;
//   3. une fermeture, un conflit ;
//   4. « est-ce que ça correspond à ma feuille ? » — d'où les totaux par équipe.

import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PreviewResult } from '@/lib/planning/cycle-preview'

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** « mardi 14 » — jamais « 2026-07-14 ». */
function dayLabel(iso: string): { dow: string; num: number; weekend: boolean } {
  const d = new Date(`${iso}T00:00:00.000Z`)
  const dow = d.getUTCDay()
  return { dow: JOURS[dow], num: d.getUTCDate(), weekend: dow === 0 || dow === 6 }
}

export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split('-')
  return `${MOIS[Number(m) - 1]} ${y}`
}

/** Premier et dernier jour d'un mois, en ISO. */
export function monthBounds(monthIso: string): { from: string; to: string } {
  const [y, m] = monthIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${monthIso}-01`, to: `${monthIso}-${String(last).padStart(2, '0')}` }
}

/** Le mois d'à côté — sans jamais franchir une frontière d'année à la main. */
export function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function CyclePreview({
  preview,
  month,
  labelOf,
  loading,
  onMonth,
  onBack,
  onDraft,
  onPublish,
  saving,
  isEdit,
}: {
  preview: PreviewResult
  month: string
  labelOf: (teamId: string) => string
  loading: boolean
  onMonth: (month: string) => void
  onBack: () => void
  onDraft: () => void
  onPublish: () => void
  saving: boolean
  isEdit: boolean
}) {
  const { days, summary } = preview
  const busy = loading || saving

  return (
    <div className="space-y-4">
      {/* Le mois qu'on regarde */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" onClick={() => onMonth(shiftMonth(month, -1))} disabled={busy} aria-label="Mois précédent">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold capitalize">
          {monthLabel(month)}
          {loading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </p>
        <Button variant="ghost" size="icon" onClick={() => onMonth(shiftMonth(month, 1))} disabled={busy} aria-label="Mois suivant">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Ce qu'il doit regarder avant de publier. Le trou d'abord. */}
      <section className="grid gap-2 sm:grid-cols-3">
        <Stat value={summary.workedDays} label="jours couverts" />
        <Stat
          value={summary.uncoveredDays}
          label={summary.uncoveredDays > 1 ? 'jours sans personne' : 'jour sans personne'}
          alert={summary.uncoveredDays > 0}
        />
        <Stat
          value={summary.conflicts}
          label={summary.conflicts > 1 ? 'jours en conflit' : 'jour en conflit'}
          alert={summary.conflicts > 0}
        />
      </section>

      {/* « 9 / 23 / 22 » — les totaux de sa feuille. C'est SA vérification. */}
      {Object.keys(summary.daysByTeam).length > 0 && (
        <section className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl border bg-card px-4 py-3 text-sm">
          {Object.entries(summary.daysByTeam).map(([teamId, n]) => (
            <span key={teamId} className="inline-flex items-baseline gap-1.5">
              <span className="font-medium">{labelOf(teamId)}</span>
              <span className="tabular-nums text-muted-foreground">
                {n} jour{n > 1 ? 's' : ''}
              </span>
            </span>
          ))}
        </section>
      )}

      {/* Le mois, jour par jour. */}
      <section className="divide-y overflow-hidden rounded-2xl border bg-card">
        {days.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Le roulement ne couvre aucun jour de ce mois.
          </p>
        )}
        {days.map((d) => {
          const { dow, num, weekend } = dayLabel(d.date)
          const vide = d.coverage === 0
          return (
            <div
              key={d.date}
              className={`flex items-start gap-3 px-3 py-2 ${weekend ? 'bg-muted/30' : ''} ${
                d.conflict ? 'bg-rose-50/70' : vide ? 'bg-rose-50/40' : ''
              }`}
            >
              <div className="w-14 shrink-0 pt-0.5 text-right">
                <span className="text-[11px] text-muted-foreground">{dow}</span>{' '}
                <span className="text-sm font-semibold tabular-nums">{num}</span>
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                {vide ? (
                  <p className="text-sm font-medium text-rose-700">Personne ce jour-là</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {d.working.map((w) => (
                      <span
                        key={w.teamId}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-900"
                      >
                        <span className="font-medium">{labelOf(w.teamId)}</span>
                        {w.startTime && (
                          <span className="tabular-nums text-emerald-700/80">
                            {w.startTime}–{w.endTime}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* Le repos SE VOIT : sa feuille est faite pour le lire. */}
                {d.restingTeamIds.length > 0 && !vide && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    Repos : {d.restingTeamIds.map(labelOf).join(', ')}
                  </p>
                )}

                {/* La couverture, dite en toutes lettres : c'est la ligne qu'il
                    cherche du regard sur sa feuille. */}
                {!vide && (
                  <p className="text-[11px] text-muted-foreground">
                    Couverture : {d.coverage} équipe{d.coverage > 1 ? 's' : ''}
                  </p>
                )}

                {d.closure && (
                  <p
                    className={`inline-flex items-center gap-1 text-[11px] ${
                      d.conflict ? 'font-medium text-rose-700' : 'text-muted-foreground'
                    }`}
                  >
                    {d.conflict ? <AlertTriangle className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {d.conflict ? 'Chantier fermé, mais du monde est prévu' : 'Chantier fermé'}
                    {d.closure.reason ? ` — ${d.closure.reason}` : ''}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Retour à la grille
        </Button>
        <Button variant="outline" onClick={onDraft} disabled={busy}>
          Enregistrer comme brouillon
        </Button>
        <Button onClick={onPublish} disabled={busy}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {isEdit ? 'Publier les modifications' : 'Publier le roulement'}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Un brouillon ne place rien dans la semaine. La publication crée les interventions du
        roulement.
      </p>
    </div>
  )
}

function Stat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        alert ? 'border-rose-200 bg-rose-50' : 'bg-card'
      }`}
    >
      <p className={`text-xl font-semibold tabular-nums ${alert ? 'text-rose-700' : ''}`}>{value}</p>
      <p className={`text-xs ${alert ? 'text-rose-700/80' : 'text-muted-foreground'}`}>{label}</p>
    </div>
  )
}
