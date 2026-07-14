'use client'

// PL3b — les gestes, là où le conflit se voit : dans le tiroir de la semaine.
//
// ⚖️ MEMORIA NE DÉCIDE JAMAIS. Il propose des dates RÉELLEMENT ouvertes (vérifiées
//    contre les fermetures du chantier, côté serveur), l'humain tranche, et la
//    décision est tracée — elle se relit un an plus tard.
//
// Aucun bouton qui mène à un autre conflit : si aucun jour n'est ouvert à
// ±14 jours, on ne propose pas de déplacement. Un geste impossible affiché est
// pire qu'un geste absent.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, ArrowRight, CalendarPlus, Check, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { gapFr, type ResolutionOption } from '@/lib/planning/conflict-resolution'
import { resolveConflictAction } from './conflict-actions'

/** Un geste. Défini HORS du composant : le recréer à chaque rendu remonterait
 *  l'arbre React à zéro (et le lint le refuse, à juste titre). */
function Btn({
  onClick,
  loading,
  icon,
  children,
  disabled,
  tone = 'neutral',
}: {
  onClick: () => void
  loading: boolean
  icon: React.ReactNode
  children: React.ReactNode
  disabled: boolean
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
        tone === 'danger' ? 'text-rose-800 hover:bg-rose-50' : 'hover:bg-muted/60'
      }`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

export function ConflictResolver({
  interventionIds,
  closureId,
  conflictDate,
  options,
}: {
  /** Les prestations encore prévues ce jour-là. */
  interventionIds: string[]
  closureId: string
  conflictDate: string
  /**
   * Les dates proposées — calculées CÔTÉ SERVEUR, contre les vraies fermetures
   * du chantier.
   *
   * Elles étaient d'abord chargées depuis un `useEffect` : une action serveur
   * au montage du tiroir. C'était faux à deux titres — un aller-retour réseau
   * pour afficher deux dates, et un `cookies()` hors requête dès qu'on rend le
   * composant hors navigateur. Le tiroir est maintenant instantané.
   */
  options: ResolutionOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const first = interventionIds[0]
  const many = interventionIds.length > 1

  function decide(
    decision: 'moved' | 'kept' | 'cancelled',
    movedTo: string | null,
    key: string,
  ) {
    if (pending || !first) return
    setBusy(key)
    start(async () => {
      // Toutes les prestations du jour partagent le même sort : Guillaume tranche
      // pour LE JOUR, pas ligne par ligne.
      for (const id of interventionIds) {
        const r = await resolveConflictAction({
          interventionId: id,
          closureId,
          conflictDate,
          decision,
          movedTo,
        })
        if ('error' in r) {
          setBusy(null)
          toast.error(r.error)
          return
        }
      }
      setBusy(null)
      toast.success(
        decision === 'moved'
          ? `Déplacée${many ? 's' : ''} au ${frDayMonthLocal(movedTo!)}.`
          : decision === 'kept'
            ? 'Maintenue — le conflit ne sera plus signalé.'
            : `Annulée${many ? 's' : ''}.`,
      )
      router.refresh()
    })
  }

  function decideCustom() {
    if (!custom) return toast.error('Choisissez une date')
    decide('moved', custom, 'custom')
  }

  if (!first) return null

  return (
    <div className="mt-2.5 space-y-1.5 border-t border-rose-200/70 pt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
        Que fait-on ?
      </p>

      <>
          {/* Les dates proposées — jamais une date fermée. */}
          {options.map((o) => (
            <Btn
              key={o.kind}
              disabled={pending}
              loading={pending && busy === o.kind}
              onClick={() => decide('moved', o.date, o.kind)}
              icon={
                o.kind === 'move_before' ? (
                  <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              }
            >
              Déplacer au <strong>{frDayMonthLocal(o.date)}</strong>{' '}
              <span className="text-xs text-muted-foreground">
                ({gapFr(o.gapDays, o.kind === 'move_before' ? 'before' : 'after')})
              </span>
            </Btn>
          ))}

          {options.length === 0 && (
            <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
              Aucun jour ouvert à moins de deux semaines — une fermeture longue ne
              se règle pas par un déplacement.
            </p>
          )}

          {/* Une autre date : il choisit, on vérifie qu'elle est ouverte. */}
          {customOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                disabled={pending}
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={decideCustom}
                disabled={pending}
                className="shrink-0 rounded-md bg-brand-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {pending && busy === 'custom' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Déplacer'
                )}
              </button>
            </div>
          ) : (
            <Btn
              disabled={pending}
              loading={false}
              onClick={() => setCustomOpen(true)}
              icon={<CalendarPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            >
              Choisir une autre date
            </Btn>
          )}

          {/* Maintenir : le lieu peut être fermé au public et ouvert au prestataire. */}
          <Btn
            disabled={pending}
            loading={pending && busy === 'kept'}
            onClick={() => decide('kept', null, 'kept')}
            icon={<Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" />}
          >
            Maintenir quand même{' '}
            <span className="text-xs text-muted-foreground">(on y va malgré la fermeture)</span>
          </Btn>

          <Btn
            disabled={pending}
            loading={pending && busy === 'cancelled'}
            tone="danger"
            onClick={() => decide('cancelled', null, 'cancelled')}
            icon={<Ban className="h-3.5 w-3.5 shrink-0" />}
          >
            Annuler cette prestation
          </Btn>

          <p className="pt-0.5 text-[11px] text-muted-foreground">
            Votre décision est enregistrée : elle se relira plus tard.
          </p>
      </>
    </div>
  )
}
