'use client'

// Liste d'actions ouvertes (site_actions) — fiche site, mobile site, briefing,
// /actions, /m/actions.
// Deux gestes : CLÔTURER (commentaire requis + photo optionnelle → journal) ou
// PLANIFIER en intervention (mission + date + créneau → l'action passe 'planned').
// La planification n'est proposée qu'en mode bureau (desktop), pas en compact terrain.

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, MapPin, Mic, HardHat, User, Loader2, Clock, Camera, X, CalendarClock, Link2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { closeActionAction, markActionProgressAction, planActionAction, listSiteMissionsForPlanningAction, listActiveTeamsForPlanningAction, associateActionToElementAction, listSiteSubjectsForAssociationAction } from '@/app/(dashboard)/actions/actions'
import { actionHealth } from '@/lib/actions/health'
import { looksLikeAction } from '@/lib/db/subject-doctrine'
import type { SiteActionRow } from '@/lib/db/site-actions'

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}
function ageLabel(iso: string): string {
  const d = ageDays(iso)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'depuis 1 jour'
  return `depuis ${d} jours`
}
function tomorrowIso(): string {
  return new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
}
function isTodayLocal(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso).toDateString() === new Date().toDateString()
}

type Mode = { id: string; kind: 'close' | 'plan' | 'associate' } | null

export function OpenActionsList({
  actions,
  showSite = false,
  compact = false,
}: {
  actions: SiteActionRow[]
  showSite?: boolean
  compact?: boolean
}) {
  const router = useRouter()
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>(null)
  // « Fait aujourd'hui » — override local optimiste (id → fait aujourd'hui ?).
  const [progress, setProgress] = useState<Map<string, boolean>>(new Map())
  const [, startProgress] = useTransition()

  function dropAndRefresh(id: string) {
    setRemoved((prev) => new Set(prev).add(id))
    setMode(null)
    router.refresh()
  }

  const visible = actions.filter((a) => !removed.has(a.id))
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground italic px-1 py-2">Aucune action ouverte.</p>
  }

  const isDoneToday = (a: SiteActionRow) => (progress.has(a.id) ? progress.get(a.id)! : isTodayLocal(a.last_progress_at))
  const todo = visible.filter((a) => !isDoneToday(a))
  const doneToday = visible.filter((a) => isDoneToday(a))

  function markProgress(a: SiteActionRow, on: boolean) {
    setProgress((prev) => new Map(prev).set(a.id, on))
    startProgress(async () => {
      const r = await markActionProgressAction({ id: a.id, site_id: a.site_id, on })
      if (!r.ok) {
        setProgress((prev) => new Map(prev).set(a.id, !on))
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="space-y-3">
      {todo.length === 0 ? (
        <p className="px-1 py-1 text-sm italic text-muted-foreground">Rien de plus à faire aujourd&apos;hui. 🎉</p>
      ) : (
      <ul className="space-y-2">
        {todo.map((a) => {
        const health = actionHealth(a.created_at)
        const borderCls =
          health === 'critique' ? 'border-red-300' : health === 'surveiller' ? 'border-amber-200' : 'border-border'
        const ageCls =
          health === 'critique' ? 'text-red-700 font-medium' : health === 'surveiller' ? 'text-amber-700 font-medium' : ''
        const isClosing = mode?.id === a.id && mode.kind === 'close'
        const isPlanning = mode?.id === a.id && mode.kind === 'plan'
        const isAssociating = mode?.id === a.id && mode.kind === 'associate'
        return (
          <li key={a.id} className={`rounded-lg border bg-card ${compact ? 'p-2.5' : 'p-3'} ${borderCls}`}>
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => setMode(isClosing ? null : { id: a.id, kind: 'close' })}
                aria-label="Marquer l'action comme définitivement traitée"
                aria-expanded={isClosing}
                className={`mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors active:scale-95 ${
                  isClosing ? 'border-emerald-500 bg-emerald-50' : 'border-foreground/30 hover:border-emerald-500 hover:bg-emerald-50'
                }`}
              >
                <Check className={`h-3.5 w-3.5 ${isClosing ? 'text-emerald-600' : 'text-transparent hover:text-emerald-600'}`} />
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
                  <span className={`inline-flex items-center gap-1 ${ageCls}`}>
                    <Clock className="h-3 w-3" />Ouvert {ageLabel(a.created_at)}
                  </span>
                </div>

                {isClosing ? (
                  <CloseForm action={a} onCancel={() => setMode(null)} onDone={() => dropAndRefresh(a.id)} />
                ) : isPlanning ? (
                  <PlanForm action={a} onCancel={() => setMode(null)} onDone={() => dropAndRefresh(a.id)} />
                ) : isAssociating ? (
                  <AssociateForm action={a} onCancel={() => setMode(null)} onDone={() => { setMode(null); router.refresh() }} />
                ) : (
                  <>
                    {/* « Fait aujourd'hui » — avancée terrain, NE clôture PAS l'action (elle reste vivante). */}
                    <button
                      type="button"
                      onClick={() => markProgress(a, true)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 active:scale-[0.98] dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      <Check className="h-3.5 w-3.5" /> Fait aujourd&apos;hui
                    </button>
                    {/* Actions cliquables en BADGES (desktop) — « Planifier » mise en avant. */}
                    <div className={`mt-2 items-center gap-2 ${compact ? 'hidden' : 'flex flex-wrap'}`}>
                    {!compact && (
                      <button
                        type="button"
                        onClick={() => setMode({ id: a.id, kind: 'plan' })}
                        className="inline-flex items-center gap-1.5 rounded-full border border-foreground/30 bg-background px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-foreground hover:text-background active:scale-[0.98]"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />Planifier
                      </button>
                    )}
                    {/* Chemin direct Action → Élément (alimentation du graphe hors décisions). */}
                    {!compact && (a.subject_id ? (
                      <Link
                        href={`/sites/${a.site_id}/subjects/${a.subject_id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100"
                      >
                        <Link2 className="h-3.5 w-3.5" />Point suivi
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMode({ id: a.id, kind: 'associate' })}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-violet-300 hover:text-violet-700"
                      >
                        <Link2 className="h-3.5 w-3.5" />Suivre ce point
                      </button>
                    ))}
                    <Link
                      href={`/sites/${a.site_id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <MapPin className="h-3.5 w-3.5" />Voir le site
                    </Link>
                    {a.report_id && (
                      <Link
                        href={`/meetings/${a.report_id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        <Mic className="h-3.5 w-3.5" />Réunion source
                      </Link>
                    )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </li>
        )
      })}
      </ul>
      )}

      {doneToday.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fait aujourd&apos;hui</p>
          <ul className="space-y-1">
            {doneToday.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{a.title}</span>
                <button type="button" onClick={() => markProgress(a, false)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                  Annuler
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground">Restent ouvertes — elles réapparaîtront tant qu&apos;elles ne sont pas définitivement traitées.</p>
        </div>
      )}
    </div>
  )
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
      toast.error('Ajoutez un commentaire de clôture.')
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
      else {
        toast.success('Action traitée')
        onDone()
      }
    })
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground/80">Cette action est-elle complètement traitée&nbsp;?</p>
      <p className="text-[10px] text-muted-foreground -mt-1">Pas « j&apos;ai fini ma mission du jour » : « ce point ne nécessite plus de suivi ».</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        autoFocus
        maxLength={1000}
        placeholder="Ex : joints repris et vérifiés — plus rien à suivre."
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-3.5 w-3.5" />
          {photoName ? 'Photo ajoutée' : 'Photo (optionnel)'}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />Annuler
          </button>
          <button type="button" onClick={submit} disabled={pending || !comment.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98]">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Définitivement traitée
          </button>
        </div>
      </div>
    </div>
  )
}

function PlanForm({
  action,
  onCancel,
  onDone,
}: {
  action: SiteActionRow
  onCancel: () => void
  onDone: () => void
}) {
  const [missions, setMissions] = useState<Array<{ id: string; name: string }>>([])
  const [loadingMissions, setLoadingMissions] = useState(true)
  // missionChoice : '' (= nouvelle mission ponctuelle) ou un id de mission existante.
  const [missionChoice, setMissionChoice] = useState<string>('')
  const [newName, setNewName] = useState(action.title)
  const [date, setDate] = useState(action.due_date ?? tomorrowIso())
  const [slot, setSlot] = useState<'morning' | 'afternoon' | 'evening'>('morning')
  // teamChoice : 'inherit' (équipe par défaut de la mission) | 'unassigned' | uuid.
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [teamChoice, setTeamChoice] = useState<string>('inherit')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    Promise.all([
      listSiteMissionsForPlanningAction(action.site_id),
      listActiveTeamsForPlanningAction().catch(() => []),
    ])
      .then(([ms, ts]) => {
        if (!alive) return
        setMissions(ms)
        if (ms.length > 0) setMissionChoice(ms[0].id)
        setTeams(ts.map((t) => ({ id: t.id, name: t.name })))
        setLoadingMissions(false)
      })
      .catch(() => setLoadingMissions(false))
    return () => { alive = false }
  }, [action.site_id])

  function submit() {
    const fd = new FormData()
    fd.set('id', action.id)
    fd.set('site_id', action.site_id)
    fd.set('scheduled_for', date)
    fd.set('slot', slot)
    if (missionChoice) {
      fd.set('mission_mode', 'existing')
      fd.set('mission_id', missionChoice)
    } else {
      fd.set('mission_mode', 'new')
      fd.set('new_mission_name', newName.trim() || action.title)
    }
    fd.set('team', teamChoice)
    startTransition(async () => {
      const r = await planActionAction(fd)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Action planifiée en intervention')
        onDone()
      }
    })
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground/80 inline-flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" />Planifier en intervention
      </p>

      {/* Mission */}
      <label className="block text-[11px] text-muted-foreground">
        Mission
        {loadingMissions ? (
          <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />…</span>
        ) : (
          <select
            value={missionChoice}
            onChange={(e) => setMissionChoice(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {missions.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
            <option value="">+ Nouvelle mission ponctuelle</option>
          </select>
        )}
      </label>
      {!loadingMissions && missionChoice === '' && (
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={120}
          placeholder="Nom de la mission"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      )}

      {/* Date + créneau */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value as 'morning' | 'afternoon' | 'evening')}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="morning">Matin</option>
          <option value="afternoon">Après-midi</option>
          <option value="evening">Soir</option>
        </select>
      </div>

      {/* Équipe — par défaut héritée de la mission ; sinon Non-affecté ; ou
          une équipe précise (ex. Gros œuvre). L'intervention naît affectée. */}
      <label className="block text-[11px] text-muted-foreground">
        Équipe
        <select
          value={teamChoice}
          onChange={(e) => setTeamChoice(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="inherit">Équipe par défaut de la mission</option>
          <option value="unassigned">Non-affecté (à attribuer plus tard)</option>
          {teams.length > 0 && (
            <optgroup label="Équipes">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || loadingMissions}
          className="inline-flex items-center gap-1.5 rounded-md border-2 border-foreground bg-foreground text-background px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50 active:scale-[0.98]">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
          Planifier
        </button>
      </div>
    </div>
  )
}

// Associer une action à un ÉLÉMENT à mémoriser. On ne demande PAS « est-ce un sujet ? »
// mais « concerne-t-elle un élément durable ? ». Existant (réutilise) ou créer (titre
// pré-rempli, modifiable). Déterministe, anti-doublon côté serveur, jamais auto.
function AssociateForm({
  action,
  onCancel,
  onDone,
}: {
  action: SiteActionRow
  onCancel: () => void
  onDone: () => void
}) {
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'existing' | 'create'>('create')
  const [subjectId, setSubjectId] = useState('')
  const [name, setName] = useState(action.title)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    listSiteSubjectsForAssociationAction(action.site_id)
      .then((s) => {
        if (!alive) return
        setSubjects(s)
        if (s.length > 0) { setMode('existing'); setSubjectId(s[0].id) }
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { alive = false }
  }, [action.site_id])

  const actionLike = mode === 'create' && looksLikeAction(name)
  const canSubmit = mode === 'existing' ? !!subjectId : name.trim().length > 0

  function submit() {
    const fd = new FormData()
    fd.set('actionId', action.id)
    fd.set('siteId', action.site_id)
    fd.set('mode', mode)
    if (mode === 'existing') fd.set('subjectId', subjectId)
    else fd.set('name', name.trim())
    startTransition(async () => {
      const r = await associateActionToElementAction(fd)
      if (r.ok) { toast.success('Point suivi'); onDone() }
      else toast.error(r.error)
    })
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground/80 inline-flex items-center gap-1.5">
        <Link2 className="h-3.5 w-3.5" />Suivre automatiquement ce point dans le temps&nbsp;?
      </p>

      {subjects.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} className="mt-1 accent-violet-600" />
          <span className="min-w-0 flex-1">
            <span className="text-[11px] text-muted-foreground">Rattacher à un point déjà suivi</span>
            <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setMode('existing') }}
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} className="mt-1 accent-violet-600" />
        <span className="min-w-0 flex-1">
          <span className="text-[11px] text-muted-foreground">Nouveau point {loading ? '' : '(titre proposé, à raccourcir)'}</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setMode('create') }} maxLength={160}
            placeholder="Ex. Motricité sur échelle, DOE porte coupe-feu"
            className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
          {actionLike && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-700">
              <AlertTriangle className="h-3 w-3" /> Ça ressemble à une action — nomme plutôt le point durable derrière (le « pourquoi »).
            </span>
          )}
        </span>
      </label>

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || !canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md border-2 border-violet-600 bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Valider
        </button>
      </div>
    </div>
  )
}
