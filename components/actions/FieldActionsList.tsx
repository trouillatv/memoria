'use client'

// Cockpit terrain des actions ouvertes (/m/actions) — maquette Vincent.
// Pensé pour le geste le plus FRÉQUENT (suivi quotidien) plutôt que le cas rare
// (clôture). Vocabulaire métier : Guillaume ne pense pas « terminée / pas
// terminée » mais « est-ce que je reviens ? ».
//   ○ radio → « Tu reviendras sur cette action ? »
//        • Je reviendrai  → suivi quotidien (immédiat, sans commentaire)
//        • C'est terminé  → clôture (formulaire : commentaire + photo)
//        • Reporter…      → motif léger (attente client/matériel, météo) ; reste open
// Composant DÉDIÉ terrain : ne touche pas OpenActionsList (desktop/briefing).

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, User, Clock, ChevronRight, ChevronDown, Camera, Loader2, Target, MapPin, CheckCircle2, PauseCircle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { closeActionAction, markActionProgressAction, snoozeActionAction } from '@/app/(dashboard)/actions/actions'
import type { SiteActionRow } from '@/lib/db/site-actions'

type Priority = 'retard' | 'aujourdhui' | 'suivi'
type SnoozeReason = 'attente_client' | 'attente_materiel' | 'meteo' | 'autre'

const SNOOZE_LABELS: Record<SnoozeReason, string> = {
  attente_client: 'En attente client',
  attente_materiel: 'En attente matériel',
  meteo: 'Météo',
  autre: 'Autre',
}
const SNOOZE_ORDER: SnoozeReason[] = ['attente_client', 'attente_materiel', 'meteo', 'autre']

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}
// Différence en jours civils locaux (pour « aujourd'hui / hier / il y a N j »).
function dayDiff(iso: string): number {
  const d = new Date(iso)
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const now = new Date()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}
function dayLabel(iso: string): string {
  const n = dayDiff(iso)
  if (n <= 0) return "aujourd'hui"
  if (n === 1) return 'hier'
  return `il y a ${n} j`
}
function priorityOf(a: SiteActionRow, today: string): Priority {
  if (a.due_date) {
    const d = a.due_date.slice(0, 10)
    if (d < today) return 'retard'
    if (d === today) return 'aujourdhui'
  }
  return 'suivi'
}

const PRIORITY_META: Record<Priority, { rank: number; bar: string; badge: string; label: string }> = {
  retard: { rank: 0, bar: 'border-l-red-500', badge: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'En retard' },
  aujourdhui: { rank: 1, bar: 'border-l-amber-400', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: "À faire aujourd'hui" },
  suivi: { rank: 2, bar: 'border-l-transparent', badge: 'bg-muted text-muted-foreground', label: 'En suivi' },
}

type Sort = 'priorite' | 'recent'
type Filter = 'tout' | Priority

export function FieldActionsList({ actions }: { actions: SiteActionRow[] }) {
  const router = useRouter()
  const today = todayIso()
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [doneOverride, setDoneOverride] = useState<Map<string, boolean>>(new Map())
  const [snoozeOverride, setSnoozeOverride] = useState<Map<string, SnoozeReason | null>>(new Map())
  const [openId, setOpenId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('priorite')
  const [filter, setFilter] = useState<Filter>('tout')
  const [, startBg] = useTransition()

  const isDoneToday = (a: SiteActionRow) =>
    doneOverride.has(a.id) ? doneOverride.get(a.id)! : (!!a.last_progress_at && dayDiff(a.last_progress_at) <= 0)
  const snoozeOf = (a: SiteActionRow): SnoozeReason | null =>
    snoozeOverride.has(a.id) ? snoozeOverride.get(a.id)! : ((a.snooze_reason as SnoozeReason | null) ?? null)

  const visible = actions.filter((a) => !removed.has(a.id))

  const counts = useMemo(() => {
    const c = { total: 0, retard: 0, aujourdhui: 0, suivi: 0 }
    for (const a of visible) { c.total++; c[priorityOf(a, today)]++ }
    return c
  }, [visible, today])

  const groups = useMemo(() => {
    const filtered = filter === 'tout' ? visible : visible.filter((a) => priorityOf(a, today) === filter)
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'recent') return b.created_at.localeCompare(a.created_at)
      const d = PRIORITY_META[priorityOf(a, today)].rank - PRIORITY_META[priorityOf(b, today)].rank
      return d !== 0 ? d : a.created_at.localeCompare(b.created_at)
    })
    const map = new Map<string, { name: string; rows: SiteActionRow[] }>()
    for (const a of sorted) {
      if (!map.has(a.site_id)) map.set(a.site_id, { name: a.site_name, rows: [] })
      map.get(a.site_id)!.rows.push(a)
    }
    return [...map.entries()]
  }, [visible, sort, filter, today])

  function markProgress(a: SiteActionRow) {
    setDoneOverride((p) => new Map(p).set(a.id, true))
    setOpenId(null); setReportingId(null)
    startBg(async () => {
      const r = await markActionProgressAction({ id: a.id, site_id: a.site_id, on: true })
      if (!r.ok) { setDoneOverride((p) => new Map(p).set(a.id, false)); toast.error(r.error) }
    })
  }
  function snooze(a: SiteActionRow, reason: SnoozeReason | null) {
    const prev = snoozeOf(a)
    setSnoozeOverride((p) => new Map(p).set(a.id, reason))
    setOpenId(null); setReportingId(null)
    startBg(async () => {
      const r = await snoozeActionAction({ id: a.id, site_id: a.site_id, reason })
      if (!r.ok) { setSnoozeOverride((p) => new Map(p).set(a.id, prev)); toast.error(r.error) }
    })
  }
  function onClosed(id: string) {
    setRemoved((p) => new Set(p).add(id))
    setClosingId(null); setOpenId(null)
    router.refresh()
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-3xl border border-foreground/[0.06] bg-muted/20 px-5 py-10 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" strokeWidth={1.5} />
        <p className="mt-3 text-sm font-medium">Aucune action ouverte.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Tout est suivi — tu peux continuer ton intervention.</p>
      </div>
    )
  }

  const soleSite = new Set(visible.map((a) => a.site_id)).size === 1 ? visible[0].site_name : null

  return (
    <div className="space-y-6">
      {/* Synthèse — cliquable : chaque chiffre filtre la liste. */}
      <section className="rounded-3xl border border-foreground/[0.08] bg-card px-5 py-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Target className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <h2 className="text-base font-semibold tracking-tight">Synthèse{soleSite ? ` — ${soleSite}` : ''}</h2>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <StatButton value={counts.total} label="actions" active={filter === 'tout'} onClick={() => setFilter('tout')} />
          <StatButton value={counts.aujourdhui} label="à faire aujourd'hui" tone="text-amber-600" active={filter === 'aujourdhui'} onClick={() => setFilter(filter === 'aujourdhui' ? 'tout' : 'aujourdhui')} />
          <StatButton value={counts.retard} label="en retard" tone="text-red-600" active={filter === 'retard'} onClick={() => setFilter(filter === 'retard' ? 'tout' : 'retard')} />
          <StatButton value={counts.suivi} label="en suivi" active={filter === 'suivi'} onClick={() => setFilter(filter === 'suivi' ? 'tout' : 'suivi')} />
        </div>
        <p className="text-[13px] text-muted-foreground">{synthesisPhrase(counts)}</p>
      </section>

      {groups.map(([siteId, g], gi) => (
        <section key={siteId} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-muted-foreground" />{g.name}
            </h3>
            {gi === 0 && (
              <button
                type="button"
                onClick={() => setSort((s) => (s === 'priorite' ? 'recent' : 'priorite'))}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground active:scale-[0.97] transition-transform"
              >
                {sort === 'priorite' ? 'Priorité' : 'Récence'}<ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <ul className="space-y-2.5">
            {g.rows.map((a) => {
              const prio = priorityOf(a, today)
              const meta = PRIORITY_META[prio]
              const done = isDoneToday(a)
              const snz = snoozeOf(a)
              const isOpen = openId === a.id
              const isClosing = closingId === a.id
              const isReporting = reportingId === a.id
              const timeText = a.last_progress_at && dayDiff(a.last_progress_at) >= 0
                ? `Suivi ${dayLabel(a.last_progress_at)}`
                : (dayDiff(a.created_at) <= 0 ? "créée aujourd'hui" : dayLabel(a.created_at))
              return (
                <li key={a.id} className={`overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card shadow-sm border-l-[3px] ${meta.bar}`}>
                  <div className="flex items-start gap-3 p-4">
                    <button
                      type="button"
                      onClick={() => { setOpenId(isOpen ? null : a.id); setClosingId(null); setReportingId(null) }}
                      aria-label="Suivre, reporter ou terminer cette action"
                      aria-expanded={isOpen}
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors active:scale-95 ${
                        done ? 'border-emerald-500 bg-emerald-500 text-white'
                          : isOpen ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
                          : 'border-foreground/25 text-transparent'
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badge}`}>{meta.label}</span>
                        {snz && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <PauseCircle className="h-3 w-3" />{SNOOZE_LABELS[snz]}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-[15px] font-medium leading-snug line-clamp-3">{a.title}</p>

                      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                        {a.assigned_to && (
                          <><span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{a.assigned_to}</span><span className="text-muted-foreground/40">•</span></>
                        )}
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{timeText}</span>
                      </div>
                    </div>

                    {!isOpen && <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" />}
                  </div>

                  {/* Choix métier — « est-ce que je reviens ? » */}
                  {isOpen && !isClosing && !isReporting && (
                    <div className="border-t border-foreground/[0.06] px-4 py-3.5 space-y-2.5">
                      <p className="text-[13px] font-medium">Tu reviendras sur cette action&nbsp;?</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button type="button" onClick={() => markProgress(a)}
                          className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-center text-[13px] font-semibold text-emerald-700 active:scale-[0.98] transition-transform dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" />Je reviendrai</span>
                          <span className="text-[11px] font-normal opacity-80">suivi quotidien</span>
                        </button>
                        <button type="button" onClick={() => setClosingId(a.id)}
                          className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-center text-[13px] font-semibold text-red-700 active:scale-[0.98] transition-transform dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                          <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" />C&apos;est terminé</span>
                          <span className="text-[11px] font-normal opacity-80">définitivement</span>
                        </button>
                      </div>
                      <div className="text-center">
                        {snz ? (
                          <button type="button" onClick={() => snooze(a, null)} className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                            Reporté : {SNOOZE_LABELS[snz]} · retirer
                          </button>
                        ) : (
                          <button type="button" onClick={() => setReportingId(a.id)} className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                            Reporter…
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Reporter — motif léger, l'action reste ouverte. */}
                  {isReporting && (
                    <div className="border-t border-foreground/[0.06] px-4 py-3.5 space-y-2.5">
                      <p className="text-[13px] font-medium">Pourquoi reste-t-elle ouverte&nbsp;?</p>
                      <div className="flex flex-wrap gap-2">
                        {SNOOZE_ORDER.map((r) => (
                          <button key={r} type="button" onClick={() => snooze(a, r)}
                            className="rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground active:scale-[0.97] transition-transform hover:border-foreground/30">
                            {SNOOZE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => setReportingId(null)} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />Retour
                      </button>
                    </div>
                  )}

                  {/* Clôture — seulement si « C'est terminé ». */}
                  {isClosing && <CloseForm action={a} onCancel={() => setClosingId(null)} onDone={() => onClosed(a.id)} />}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function StatButton({ value, label, tone, active, onClick }: { value: number; label: string; tone?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-1 py-1.5 text-center transition-colors active:scale-[0.97] ${active ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
    >
      <div className={`text-2xl font-bold tabular-nums ${value > 0 ? (tone ?? 'text-foreground') : 'text-foreground/40'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </button>
  )
}

function synthesisPhrase(c: { total: number; retard: number; aujourdhui: number; suivi: number }): string {
  if (c.aujourdhui > 0) return `Concentre-toi d'abord sur ${c.aujourdhui === 1 ? "l'action à faire aujourd'hui" : `les ${c.aujourdhui} actions à faire aujourd'hui`}.`
  if (c.retard > 0) return c.retard === 1 ? 'Une action en retard à traiter.' : `${c.retard} actions en retard à traiter.`
  return 'Aucune urgence — tout est en suivi. Tu peux continuer ton intervention.'
}

function CloseForm({ action, onCancel, onDone }: { action: SiteActionRow; onCancel: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) { toast.error('Décris comment tu sais qu’elle est terminée.'); return }
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', action.site_id); fd.set('comment', comment.trim())
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
        value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus maxLength={1000}
        placeholder="Ex : exercice réalisé sans douleur, position stabilisée, objectifs atteints…"
        className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div>
        <p className="mb-1.5 text-[12px] text-muted-foreground">Preuve <span className="text-muted-foreground/60">(facultatif)</span></p>
        <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-4 w-4" />{photoName ? 'Photo ajoutée' : 'Ajouter une photo'}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
        </label>
      </div>
      <div className="flex items-center gap-2.5 pt-0.5">
        <button type="button" onClick={onCancel} disabled={pending}
          className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition-transform">Annuler</button>
        <button type="button" onClick={submit} disabled={pending || !comment.trim()}
          className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirmer la terminaison
        </button>
      </div>
    </div>
  )
}
