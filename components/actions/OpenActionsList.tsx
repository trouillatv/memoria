'use client'

// Liste d'actions ouvertes (site_actions) — réutilisée sur la fiche site,
// le mobile site, le briefing et /actions. Geste minimal : « Terminé », « Voir
// le site », « Voir la réunion source ». Pas de planification ici (séparé).

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, MapPin, Mic, HardHat, User, Loader2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { markActionDoneAction } from '@/app/(dashboard)/actions/actions'
import type { SiteActionRow } from '@/lib/db/site-actions'

function ageDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}
function ageLabel(iso: string): string {
  const d = ageDays(iso)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'depuis 1 jour'
  return `depuis ${d} jours`
}

export function OpenActionsList({
  actions,
  showSite = false,
  compact = false,
}: {
  actions: SiteActionRow[]
  /** Afficher le site (cockpit global / briefing multi-sites). */
  showSite?: boolean
  /** Variante dense pour le terrain mobile. */
  compact?: boolean
}) {
  const router = useRouter()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  function handleDone(a: SiteActionRow) {
    setDone((prev) => new Set(prev).add(a.id))
    startTransition(async () => {
      const r = await markActionDoneAction(a.id, a.site_id)
      if (!r.ok) {
        setDone((prev) => {
          const next = new Set(prev)
          next.delete(a.id)
          return next
        })
        toast.error(r.error)
      } else {
        toast.success('Action terminée')
        router.refresh()
      }
    })
  }

  const visible = actions.filter((a) => !done.has(a.id))
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground italic px-1 py-2">Aucune action ouverte.</p>
  }

  return (
    <ul className="space-y-2">
      {visible.map((a) => {
        const old = ageDays(a.created_at) >= 7
        return (
          <li
            key={a.id}
            className={`rounded-lg border bg-card ${compact ? 'p-2.5' : 'p-3'} ${old ? 'border-amber-200' : 'border-border'}`}
          >
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => handleDone(a)}
                disabled={pending}
                aria-label="Marquer terminé"
                className="mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 border-foreground/30 hover:border-emerald-500 hover:bg-emerald-50 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
              >
                {pending && done.has(a.id) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-transparent hover:text-emerald-600" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug">{a.title}</div>

                <div className="mt-1 flex items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground flex-wrap">
                  {a.corps_etat && (
                    <span className="inline-flex items-center gap-1 text-foreground/70">
                      <HardHat className="h-3 w-3" />{a.corps_etat}
                    </span>
                  )}
                  {showSite && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{a.site_name}
                      {a.contract_name ? <span className="text-muted-foreground/60"> · {a.contract_name}</span> : null}
                    </span>
                  )}
                  {a.assigned_to && (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />{a.assigned_to}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 ${old ? 'text-amber-700 font-medium' : ''}`}>
                    <Clock className="h-3 w-3" />Ouvert {ageLabel(a.created_at)}
                  </span>
                </div>

                {/* Liens : voir le site, voir la réunion source (masqués en
                    compact mobile — on est déjà sur le site, geste = cocher). */}
                <div className={`mt-1.5 items-center gap-3 text-[11px] ${compact ? 'hidden' : 'flex'}`}>
                  <Link href={`/sites/${a.site_id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <MapPin className="h-3 w-3" />Voir le site
                  </Link>
                  {a.report_id && (
                    <Link href={`/meetings/${a.report_id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Mic className="h-3 w-3" />Réunion source
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
