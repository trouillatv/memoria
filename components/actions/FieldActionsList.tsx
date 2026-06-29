'use client'

// Cockpit terrain des actions ouvertes (/m/actions) — maquette Vincent.
// Modèle d'interaction optimisé pour le geste le plus FRÉQUENT (suivi quotidien)
// plutôt que pour le cas rare (clôture définitive) :
//   ○ radio → « Cette action est terminée ? » → 2 boutons
//        • Fait aujourd'hui (suivi quotidien)  → immédiat, sans commentaire
//        • Terminée définitivement             → ouvre le formulaire (commentaire + photo)
// Trois états naturels : à faire · fait aujourd'hui · terminée définitivement.
// Composant DÉDIÉ au terrain : ne touche pas OpenActionsList (desktop/briefing).

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, User, Clock, ChevronRight, Camera, Loader2, Target, MapPin, SlidersHorizontal, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { closeActionAction, markActionProgressAction } from '@/app/(dashboard)/actions/actions'
import type { SiteActionRow } from '@/lib/db/site-actions'

type Priority = 'retard' | 'aujourdhui' | 'suivi'

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}
function isTodayLocal(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso).toDateString() === new Date().toDateString()
}
function priorityOf(a: SiteActionRow, today: string): Priority {
  if (a.due_date) {
    const d = a.due_date.slice(0, 10)
    if (d < today) return 'retard'
    if (d === today) return 'aujourdhui'
  }
  return 'suivi'
}
// « il y a N jours » depuis la création — sobre, sans le mot « Ouvert ».
function createdLabel(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  if (d === 0) return "créée aujourd'hui"
  if (d === 1) return 'il y a 1 jour'
  return `il y a ${d} jours`
}
// Dernière activité : ce que Guillaume veut vraiment savoir (récence > ancienneté).
function activityLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return "à l'instant"
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'hier'
  return `il y a ${d} jours`
}

const PRIORITY_META: Record<Priority, { rank: number; bar: string; badge: string; label: string }> = {
  retard: {
    rank: 0,
    bar: 'border-l-red-500',
    badge: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    label: 'En retard',
  },
  aujourdhui: {
    rank: 1,
    bar: 'border-l-amber-400',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    label: "À faire aujourd'hui",
  },
  suivi: {
    rank: 2,
    bar: 'border-l-transparent',
    badge: 'bg-muted text-muted-foreground',
    label: 'En suivi',
  },
}

type Sort = 'priorite' | 'recent'

export function FieldActionsList({ actions }: { actions: SiteActionRow[] }) {
  const router = useRouter()
  const today = todayIso()
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [doneOverride, setDoneOverride] = useState<Map<string, boolean>>(new Map())
  const [openId, setOpenId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('priorite')
  const [, startProgress] = useTransition()

  const isDoneToday = (a: SiteActionRow) =>
    doneOverride.has(a.id) ? doneOverride.get(a.id)! : isTodayLocal(a.last_progress_at)

  const visible = actions.filter((a) => !removed.has(a.id))

  // Synthèse globale (compteurs par priorité).
  const counts = useMemo(() => {
    const c = { total: 0, retard: 0, aujourdhui: 0, suivi: 0 }
    for (const a of visible) {
      c.total++
      c[priorityOf(a, today)]++
    }
    return c
  }, [visible, today])

  // Tri + regroupement par site (l'ordre des sites suit la 1re action triée).
  const groups = useMemo(() => {
    const sorted = [...visible].sort((a, b) => {
      if (sort === 'recent') return b.created_at.localeCompare(a.created_at)
      const pa = PRIORITY_META[priorityOf(a, today)].rank
      const pb = PRIORITY_META[priorityOf(b, today)].rank
      if (pa !== pb) return pa - pb
      return a.created_at.localeCompare(b.created_at)
    })
    const map = new Map<string, { name: string; rows: SiteActionRow[] }>()
    for (const a of sorted) {
      if (!map.has(a.site_id)) map.set(a.site_id, { name: a.site_name, rows: [] })
      map.get(a.site_id)!.rows.push(a)
    }
    return [...map.entries()]
  }, [visible, sort, today])

  function markProgress(a: SiteActionRow) {
    setDoneOverride((prev) => new Map(prev).set(a.id, true))
    setOpenId(null)
    startProgress(async () => {
      const r = await markActionProgressAction({ id: a.id, site_id: a.site_id, on: true })
      if (!r.ok) {
        setDoneOverride((prev) => new Map(prev).set(a.id, false))
        toast.error(r.error)
      }
    })
  }
  function onClosed(id: string) {
    setRemoved((prev) => new Set(prev).add(id))
    setClosingId(null)
    setOpenId(null)
    router.refresh()
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-3xl border border-foreground/[0.06] bg-muted/20 px-5 py-10 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" strokeWidth={1.5} />
        <p className="mt-3 text-sm font-medium">Aucune action ouverte.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Tout est suivi — tu peux continuer ton intervention normalement.</p>
      </div>
    )
  }

  const soleSite = groups.length === 1 ? groups[0][1].name : null

  return (
    <div className="space-y-6">
      {/* Synthèse — l'ensemble avant le détail. */}
      <section className="rounded-3xl border border-foreground/[0.08] bg-card px-5 py-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Target className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <h2 className="text-base font-semibold tracking-tight">
            Synthèse{soleSite ? ` — ${soleSite}` : ''}
          </h2>
        </div>
        <div className="grid grid-cols-4 divide-x divide-foreground/[0.06] text-center">
          <Stat value={counts.total} label="actions" />
          <Stat value={counts.aujourdhui} label="à faire aujourd'hui" tone={counts.aujourdhui > 0 ? 'text-amber-600' : undefined} />
          <Stat value={counts.retard} label="en retard" tone={counts.retard > 0 ? 'text-red-600' : undefined} />
          <Stat value={counts.suivi} label="en suivi" />
        </div>
        <p className="text-[13px] text-muted-foreground">{synthesisPhrase(counts)}</p>
      </section>

      {groups.map(([siteId, g], gi) => (
        <section key={siteId} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {g.name}
            </h3>
            {gi === 0 && (
              <button
                type="button"
                onClick={() => setSort((s) => (s === 'priorite' ? 'recent' : 'priorite'))}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground active:scale-[0.97] transition-transform"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {sort === 'priorite' ? 'Trier par priorité' : 'Trier par récence'}
              </button>
            )}
          </div>

          <ul className="space-y-2.5">
            {g.rows.map((a) => {
              const prio = priorityOf(a, today)
              const meta = PRIORITY_META[prio]
              const done = isDoneToday(a)
              const isOpen = openId === a.id
              const isClosing = closingId === a.id
              return (
                <li
                  key={a.id}
                  className={`overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card shadow-sm border-l-[3px] ${meta.bar}`}
                >
                  <div className="flex items-start gap-3 p-4">
                    <button
                      type="button"
                      onClick={() => { setOpenId(isOpen ? null : a.id); setClosingId(null) }}
                      aria-label="Suivre ou terminer cette action"
                      aria-expanded={isOpen}
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors active:scale-95 ${
                        done
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : isOpen
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
                            : 'border-foreground/25 text-transparent'
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badge}`}>
                          {meta.label}
                        </span>
                        {a.last_progress_at && (
                          <span className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
                            Dernière activité<br />{activityLabel(a.last_progress_at)}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-[15px] font-medium leading-snug line-clamp-3">{a.title}</p>

                      <div className="mt-1.5 flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        {a.assigned_to && (
                          <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{a.assigned_to}</span>
                        )}
                        {a.assigned_to && <span className="text-muted-foreground/40">•</span>}
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{createdLabel(a.created_at)}</span>
                        {done && (
                          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <Check className="h-3 w-3" />Fait aujourd&apos;hui
                          </span>
                        )}
                      </div>
                    </div>

                    {!isOpen && <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" />}
                  </div>

                  {/* Choix après tap du radio — on ne demande PAS tout de suite le formulaire. */}
                  {isOpen && !isClosing && (
                    <div className="border-t border-foreground/[0.06] px-4 py-3.5 space-y-2.5">
                      <p className="text-[13px] font-medium">Cette action est terminée&nbsp;?</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => markProgress(a)}
                          className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-center text-[13px] font-semibold text-emerald-700 active:scale-[0.98] transition-transform dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" />Fait aujourd&apos;hui</span>
                          <span className="text-[11px] font-normal opacity-80">suivi quotidien</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setClosingId(a.id)}
                          className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-center text-[13px] font-semibold text-red-700 active:scale-[0.98] transition-transform dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                        >
                          <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" />Terminée</span>
                          <span className="text-[11px] font-normal opacity-80">définitivement</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Formulaire de clôture — uniquement si « Terminée définitivement ». */}
                  {isClosing && (
                    <CloseForm action={a} onCancel={() => setClosingId(null)} onDone={() => onClosed(a.id)} />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="px-1">
      <div className={`text-2xl font-bold tabular-nums ${tone ?? 'text-foreground'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  )
}

function synthesisPhrase(c: { total: number; retard: number; aujourdhui: number; suivi: number }): string {
  if (c.aujourdhui > 0) {
    return `Concentre-toi d'abord sur ${c.aujourdhui === 1 ? "l'action à faire aujourd'hui" : `les ${c.aujourdhui} actions à faire aujourd'hui`}.`
  }
  if (c.retard > 0) {
    return c.retard === 1 ? 'Une action en retard à traiter.' : `${c.retard} actions en retard à traiter.`
  }
  return 'Aucune urgence — tout est en suivi. Tu peux continuer ton intervention.'
}

function CloseForm({
  action,
  onCancel,
  onDone,
}: {
  action: SiteActionRow
  onCancel: () => void
  onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) {
      toast.error('Décris comment tu sais qu’elle est terminée.')
      return
    }
    const fd = new FormData()
    fd.set('id', action.id)
    fd.set('site_id', action.site_id)
    fd.set('comment', comment.trim())
    const f = fileRef.current?.files?.[0]
    if (f) fd.set('file', f)
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Action terminée'); onDone() }
    })
  }

  return (
    <div className="border-t border-foreground/[0.06] bg-muted/20 px-4 py-3.5 space-y-3">
      <p className="text-[13px] font-semibold">Comment sais-tu qu&apos;elle est terminée&nbsp;?</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        autoFocus
        maxLength={1000}
        placeholder="Ex : exercice réalisé sans douleur, position stabilisée, objectifs atteints…"
        className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div>
        <p className="mb-1.5 text-[12px] text-muted-foreground">Preuve <span className="text-muted-foreground/60">(facultatif)</span></p>
        <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-4 w-4" />
          {photoName ? 'Photo ajoutée' : 'Ajouter une photo'}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
        </label>
      </div>
      <div className="flex items-center gap-2.5 pt-0.5">
        <button type="button" onClick={onCancel} disabled={pending}
          className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition-transform">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || !comment.trim()}
          className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Confirmer la terminaison
        </button>
      </div>
    </div>
  )
}
