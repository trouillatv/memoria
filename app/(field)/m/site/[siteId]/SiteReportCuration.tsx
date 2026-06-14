'use client'

// État du chantier issu de la réunion (pas un résumé, pas un sapin de Noël).
// Lecture 30 s, dans l'ordre : Résumé dirigeant → Depuis la dernière réunion →
// Blocage critique / Attentes → Demain par corps d'état → Décisions → Présents.
// Tout déterministe ou présentation ; l'humain valide, rien sans clic.

import { useMemo, useState, useTransition } from 'react'
import {
  Check, X, Loader2, Wrench, AlertTriangle, Eye, BookOpen, Users,
  Building2, CalendarClock, ClipboardList, FileCheck2, ListTodo,
  CheckCircle2, CircleDot, Sparkle, GitBranch, ShieldAlert, ChevronDown, Clock, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  DbSiteAction, DbSiteReportProposal, SiteReportProposalType,
  SiteReportParticipant, SiteReportRisk,
} from '@/types/db'
import type { PriorActionUpdate } from '@/services/ai/site-report-analysis'
import {
  curateProposalAction, createValidatedProposalsAction,
  markPriorActionDoneAction, createVigilanceFromRiskAction,
} from './report-actions'

interface Mission { id: string; name: string }

interface Props {
  reportId: string
  siteId: string | null
  candidateSites: Array<{ id: string; name: string }>
  proposals: DbSiteReportProposal[]
  existingMissions: Mission[]
  meetingNumber: number
  openActions: DbSiteAction[]
  reportDates: string[]
  participants: SiteReportParticipant[]
  risks: SiteReportRisk[]
  priorUpdates: PriorActionUpdate[]
  onDone: (result: { created: number; hasTomorrowIntervention: boolean }) => void
}

const TYPE_META: Record<SiteReportProposalType, { label: string; icon: typeof Wrench; tone: string }> = {
  action:        { label: 'Action',        icon: ListTodo,      tone: 'text-sky-700 bg-sky-50 border-sky-200' },
  intervention:  { label: 'Intervention',  icon: CalendarClock, tone: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  mission:       { label: 'Mission',       icon: ClipboardList, tone: 'text-violet-700 bg-violet-50 border-violet-200' },
  anomaly:       { label: 'Anomalie',      icon: AlertTriangle, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  vigilance:     { label: 'Vigilance',     icon: Eye,           tone: 'text-orange-700 bg-orange-50 border-orange-200' },
  note:          { label: 'À savoir',      icon: BookOpen,      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  client_memory: { label: 'Mémoire client',icon: Building2,     tone: 'text-teal-700 bg-teal-50 border-teal-200' },
  proof_request: { label: 'Preuve',        icon: FileCheck2,    tone: 'text-rose-700 bg-rose-50 border-rose-200' },
}

// Décisions qui constituent du travail à faire (pour la vue « Demain »).
const ACTIONABLE: SiteReportProposalType[] = ['action', 'intervention', 'mission', 'anomaly']

interface RowState {
  accepted: boolean
  short_label: string
  corps_etat: string
  assigned_to: string
  siteId: string
  actionOutcome: 'keep' | 'intervention' | 'mission'
  scheduledFor: string
  missionMode: 'new' | 'existing'
  missionId: string
  newMissionName: string
}

function daysSince(iso: string): number {
  const then = new Date(iso).getTime()
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

export function SiteReportCuration({
  reportId, siteId, candidateSites, proposals, existingMissions, meetingNumber,
  openActions, reportDates, participants, risks, priorUpdates, onDone,
}: Props) {
  const isContract = candidateSites.length > 0
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {}
    for (const p of proposals) {
      const mc = (p.payload?.mission_choice ?? null) as { new_mission_name?: string } | null
      const suggested = (p.payload?.suggested_date as string) ?? ''
      init[p.id] = {
        accepted: true,
        short_label: p.short_label,
        corps_etat: p.corps_etat ?? '',
        assigned_to: p.assigned_to ?? '',
        siteId: p.site_id ?? siteId ?? candidateSites[0]?.id ?? '',
        actionOutcome: 'keep',
        scheduledFor: /^\d{4}-\d{2}-\d{2}$/.test(suggested) ? suggested : '',
        missionMode: existingMissions.length > 0 ? 'existing' : 'new',
        missionId: existingMissions[0]?.id ?? '',
        newMissionName: mc?.new_mission_name ?? p.short_label.slice(0, 60),
      }
    }
    return init
  })
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set())
  const [vigilanceCreated, setVigilanceCreated] = useState<Set<number>>(new Set())
  const [showParticipants, setShowParticipants] = useState(false)
  const [isPending, startTransition] = useTransition()

  function patch(id: string, p: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  const groups = useMemo(() => {
    const map = new Map<string, DbSiteReportProposal[]>()
    for (const p of proposals) {
      const key = (rows[p.id]?.corps_etat || p.corps_etat || '').trim() || 'Général'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries())
  }, [proposals, rows])

  // ── Comparaison réunion ───────────────────────────────────────────────────
  const updatedIds = new Set(priorUpdates.map((u) => u.actionId))
  const doneUpdates = priorUpdates.filter((u) => u.status === 'done')
  const stillOpenFromUpdates = priorUpdates.filter((u) => u.status === 'still_open')
  const stillOpenUntouched = openActions.filter((a) => !updatedIds.has(a.id))

  // Âge déterministe par action ouverte : jours + nb de comptes-rendus depuis création.
  const ageByActionId = useMemo(() => {
    const m = new Map<string, { days: number; reports: number }>()
    for (const a of openActions) {
      const days = daysSince(a.created_at)
      const reports = reportDates.filter((d) => d >= a.created_at).length
      m.set(a.id, { days, reports })
    }
    return m
  }, [openActions, reportDates])

  // ── Dépendances / blocages ────────────────────────────────────────────────
  const dependencies = risks.filter((r) => r.kind === 'dependency')
  const otherRisks = risks.filter((r) => r.kind !== 'dependency')
  const criticalBlocker = dependencies[0] ?? otherRisks.find((r) => r.kind === 'risk') ?? null

  // ── Demain par corps d'état (depuis les décisions actionnables) ───────────
  const tomorrowGroups = useMemo(() => {
    const map = new Map<string, Array<{ id: string; label: string; who: string }>>()
    for (const p of proposals) {
      if (!ACTIONABLE.includes(p.type)) continue
      const r = rows[p.id]
      if (!r.accepted) continue
      const corps = (r.corps_etat || p.corps_etat || '').trim() || 'Général'
      if (!map.has(corps)) map.set(corps, [])
      map.get(corps)!.push({ id: p.id, label: r.short_label, who: r.assigned_to })
    }
    return Array.from(map.entries())
  }, [proposals, rows])

  // ── Résumé dirigeant ──────────────────────────────────────────────────────
  const stillOpenTotal = stillOpenFromUpdates.length + stillOpenUntouched.length
  const summary = [
    { label: `décision${proposals.length > 1 ? 's' : ''} nouvelle${proposals.length > 1 ? 's' : ''}`, value: proposals.length, tone: 'text-sky-700' },
    { label: `action${doneUpdates.length > 1 ? 's' : ''} clôturée${doneUpdates.length > 1 ? 's' : ''}`, value: doneUpdates.length, tone: 'text-emerald-700' },
    { label: `encore ouverte${stillOpenTotal > 1 ? 's' : ''}`, value: stillOpenTotal, tone: 'text-amber-700' },
    { label: `blocage${dependencies.length > 1 ? 's' : ''}`, value: dependencies.length, tone: 'text-red-700' },
  ]

  const acceptedCount = Object.values(rows).filter((r) => r.accepted).length
  const hasComparison = doneUpdates.length + stillOpenTotal > 0

  function markDone(actionId: string) {
    startTransition(async () => {
      const res = await markPriorActionDoneAction(actionId)
      if (res.ok) { setDoneActions((s) => new Set(s).add(actionId)); toast.success('Action clôturée') }
      else toast.error(res.error)
    })
  }
  function createVigilance(idx: number, label: string) {
    const targetSite = siteId ?? candidateSites[0]?.id ?? null
    if (!targetSite) { toast.error('Aucun site cible pour la vigilance'); return }
    startTransition(async () => {
      const fd = new FormData()
      fd.set('site_id', targetSite); fd.set('label', label)
      const res = await createVigilanceFromRiskAction(fd)
      if (res.ok) { setVigilanceCreated((s) => new Set(s).add(idx)); toast.success('Point de vigilance créé') }
      else toast.error(res.error)
    })
  }

  function submit() {
    startTransition(async () => {
      await Promise.all(
        proposals.map((p) => {
          const r = rows[p.id]
          const fd = new FormData()
          fd.set('proposal_id', p.id)
          fd.set('status', r.accepted ? 'accepted' : 'rejected')
          fd.set('short_label', r.short_label.slice(0, 140))
          fd.set('corps_etat', r.corps_etat)
          fd.set('assigned_to', r.assigned_to)
          if (isContract && r.siteId) fd.set('site_id', r.siteId)
          const payloadPatch: Record<string, unknown> = {}
          if (p.type === 'action') payloadPatch.action_outcome = r.actionOutcome
          if (r.scheduledFor) payloadPatch.scheduled_for = r.scheduledFor
          if (p.type === 'intervention' || (p.type === 'action' && r.actionOutcome === 'intervention')) {
            payloadPatch.mission_choice =
              r.missionMode === 'existing' && r.missionId
                ? { mode: 'existing', mission_id: r.missionId }
                : { mode: 'new', new_mission_name: r.newMissionName.slice(0, 120) }
          }
          fd.set('payload_patch', JSON.stringify(payloadPatch))
          return curateProposalAction(fd)
        }),
      )
      const res = await createValidatedProposalsAction(reportId)
      if (res.ok) {
        toast.success(`${res.created} élément${res.created > 1 ? 's' : ''} créé${res.created > 1 ? 's' : ''}`)
        onDone({ created: res.created, hasTomorrowIntervention: res.hasTomorrowIntervention })
      } else toast.error(res.error)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        Réunion chantier #{meetingNumber}
      </div>

      {/* ① RÉSUMÉ DIRIGEANT — lecture 3 secondes */}
      <div className="grid grid-cols-4 gap-2">
        {summary.map((s, i) => (
          <div key={i} className="rounded-lg border bg-card px-2 py-2 text-center">
            <div className={`text-xl font-bold tabular-nums leading-none ${s.value > 0 ? s.tone : 'text-muted-foreground/40'}`}>{s.value}</div>
            <div className="mt-1 text-[9px] leading-tight text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ② DEPUIS LA DERNIÈRE RÉUNION */}
      {hasComparison && (
        <section>
          <SectionTitle icon={GitBranch}>Depuis la dernière réunion</SectionTitle>
          <div className="space-y-1.5">
            {doneUpdates.map((u) => {
              const done = doneActions.has(u.actionId)
              return (
                <div key={u.actionId} className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className={`flex-1 ${done ? 'line-through text-muted-foreground' : ''}`}>
                    <span className="font-medium text-emerald-800">Terminé&nbsp;:</span> {u.title}
                    {u.note && <span className="text-emerald-700/80"> — {u.note}</span>}
                  </span>
                  {!done && (
                    <button type="button" onClick={() => markDone(u.actionId)} disabled={isPending}
                      className="shrink-0 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Clôturer</button>
                  )}
                </div>
              )
            })}
            {[...stillOpenFromUpdates.map((u) => ({ id: u.actionId, title: u.title })),
              ...stillOpenUntouched.map((a) => ({ id: a.id, title: a.title }))].map((a) => {
              const age = ageByActionId.get(a.id)
              return (
                <div key={a.id} className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-xs">
                  <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="flex-1">
                    <span className="font-medium text-amber-800">Toujours ouvert&nbsp;:</span> {a.title}
                  </span>
                  {age && (age.days >= 7 || age.reports >= 2) && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-amber-700/80">
                      <Clock className="h-3 w-3" />
                      {age.reports >= 2 ? `vu sur ${age.reports} CR` : `${age.days} j`}
                    </span>
                  )}
                </div>
              )
            })}
            <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
              <Sparkle className="h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span><span className="font-medium text-foreground">{proposals.length} nouvelle{proposals.length > 1 ? 's' : ''} décision{proposals.length > 1 ? 's' : ''}</span></span>
            </div>
          </div>
        </section>
      )}

      {/* ③ BLOCAGE CRITIQUE + ATTENTES */}
      {criticalBlocker && (
        <div className="rounded-lg border-2 border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
            <ShieldAlert className="h-3.5 w-3.5" />Blocage critique
          </div>
          <p className="mt-1 text-sm font-medium text-red-900">{criticalBlocker.label}</p>
        </div>
      )}
      {dependencies.length > 0 && (
        <section>
          <SectionTitle icon={GitBranch}>Attentes &amp; dépendances</SectionTitle>
          <div className="space-y-1.5">
            {dependencies.map((d, i) => {
              const idx = risks.indexOf(d)
              const created = vigilanceCreated.has(idx)
              return (
                <div key={i} className="flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50/60 px-2.5 py-1.5 text-xs">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                  <span className="flex-1">
                    {d.waiting_party && d.awaited ? (
                      <><span className="font-medium text-purple-900">{d.waiting_party}</span> attend <span className="font-medium text-purple-900">{d.awaited}</span></>
                    ) : d.label}
                  </span>
                  {!created ? (
                    <button type="button" onClick={() => createVigilance(idx, d.label)} disabled={isPending}
                      className="shrink-0 rounded border border-purple-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-100">+ Vigilance</button>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-purple-700 inline-flex items-center gap-0.5"><Check className="h-3 w-3" />Ajouté</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ④ DEMAIN PAR CORPS D'ÉTAT */}
      {tomorrowGroups.length > 0 && (
        <section>
          <SectionTitle icon={CalendarClock}>À faire — par corps d&apos;état</SectionTitle>
          <div className="space-y-2.5">
            {tomorrowGroups.map(([corps, items]) => (
              <div key={corps} className="rounded-lg border bg-card p-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-foreground mb-1">{corps}</h4>
                <ul className="space-y-1">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-muted-foreground/40" />
                      <span className="flex-1">{it.label}</span>
                      {it.who && <span className="shrink-0 text-[10px] text-muted-foreground">→ {it.who}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ⑤ DÉCISIONS DÉTECTÉES (éditable) */}
      <section>
        <SectionTitle icon={ListTodo}>
          Décisions <span className="ml-1 text-xs font-normal text-muted-foreground normal-case">— décochez ce qui ne doit pas être créé</span>
        </SectionTitle>
        <div className="space-y-4">
          {groups.map(([corps, items]) => (
            <div key={corps}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{corps} ({items.length})</h4>
              <div className="space-y-2">
                {items.map((p) => {
                  const r = rows[p.id]
                  const meta = TYPE_META[p.type]
                  const Icon = meta.icon
                  const showMission = p.type === 'intervention' || (p.type === 'action' && r.actionOutcome === 'intervention')
                  return (
                    <div key={p.id} className={`rounded-lg border p-3 transition-opacity ${r.accepted ? '' : 'opacity-50'}`}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.tone}`}>
                          <Icon className="h-3 w-3" />{meta.label}
                        </span>
                        <button type="button" onClick={() => patch(p.id, { accepted: !r.accepted })}
                          className={`ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md border ${r.accepted ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-background text-muted-foreground'}`}
                          aria-label={r.accepted ? 'Accepté' : 'Rejeté'}>
                          {r.accepted ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <textarea value={r.short_label} onChange={(e) => patch(p.id, { short_label: e.target.value })}
                        rows={2} maxLength={140}
                        className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                      {p.rationale && <p className="mt-1 text-[10px] italic text-muted-foreground/70 border-l-2 border-muted pl-2">« {p.rationale} »</p>}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input value={r.corps_etat} onChange={(e) => patch(p.id, { corps_etat: e.target.value })}
                          placeholder="Corps d'état" className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                        <input value={r.assigned_to} onChange={(e) => patch(p.id, { assigned_to: e.target.value })}
                          placeholder="Responsable pressenti" className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                      {/* Réunion contrat : site routé (détecté par l'IA, confirmé ici) */}
                      {isContract && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <select value={r.siteId} onChange={(e) => patch(p.id, { siteId: e.target.value })}
                            className="flex-1 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                            <option value="">— Site à préciser —</option>
                            {candidateSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      )}
                      {p.type === 'action' && (
                        <div className="mt-2 flex items-center gap-1 text-xs">
                          {(['keep', 'intervention', 'mission'] as const).map((o) => (
                            <button key={o} type="button" onClick={() => patch(p.id, { actionOutcome: o })}
                              className={`rounded-md border px-2 py-1 ${r.actionOutcome === o ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'}`}>
                              {o === 'keep' ? 'Garder' : o === 'intervention' ? 'Planifier' : 'Mission'}
                            </button>
                          ))}
                        </div>
                      )}
                      {showMission && (
                        <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-2">
                          <input type="date" value={r.scheduledFor} onChange={(e) => patch(p.id, { scheduledFor: e.target.value })}
                            className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                          {existingMissions.length > 0 && (
                            <div className="flex items-center gap-1 text-xs">
                              <button type="button" onClick={() => patch(p.id, { missionMode: 'existing' })}
                                className={`rounded-md border px-2 py-1 ${r.missionMode === 'existing' ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'}`}>Existante</button>
                              <button type="button" onClick={() => patch(p.id, { missionMode: 'new' })}
                                className={`rounded-md border px-2 py-1 ${r.missionMode === 'new' ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'}`}>Nouvelle</button>
                            </div>
                          )}
                          {r.missionMode === 'existing' && existingMissions.length > 0 ? (
                            <select value={r.missionId} onChange={(e) => patch(p.id, { missionId: e.target.value })}
                              className="w-full rounded-md border bg-background px-2 py-1 text-xs">
                              {existingMissions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          ) : (
                            <input value={r.newMissionName} onChange={(e) => patch(p.id, { newMissionName: e.target.value })}
                              placeholder="Nom de la nouvelle mission"
                              className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Autres points de vigilance (préparation, vigilance lieu) — discret */}
      {otherRisks.length > 0 && (
        <section>
          <SectionTitle icon={Eye}>Points de vigilance</SectionTitle>
          <div className="space-y-1.5">
            {otherRisks.map((rk) => {
              const idx = risks.indexOf(rk)
              const created = vigilanceCreated.has(idx)
              return (
                <div key={idx} className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50/50 px-2.5 py-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                  <span className="flex-1">{rk.label}</span>
                  {!created ? (
                    <button type="button" onClick={() => createVigilance(idx, rk.label)} disabled={isPending}
                      className="shrink-0 rounded border border-orange-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-orange-700 hover:bg-orange-100">+ Vigilance</button>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-orange-700 inline-flex items-center gap-0.5"><Check className="h-3 w-3" />Ajouté</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ⑥ PRÉSENTS — secondaire, replié */}
      {participants.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowParticipants((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Users className="h-3.5 w-3.5" />
            {participants.length} participant{participants.length > 1 ? 's' : ''} détecté{participants.length > 1 ? 's' : ''}
            <ChevronDown className={`h-3 w-3 transition-transform ${showParticipants ? 'rotate-180' : ''}`} />
          </button>
          {showParticipants && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {participants.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
                  <span className={`h-1.5 w-1.5 rounded-full ${p.kind === 'control' ? 'bg-rose-500' : p.kind === 'company' ? 'bg-violet-500' : 'bg-sky-500'}`} />
                  {p.name}{p.role && <span className="text-muted-foreground/70">· {p.role}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={submit} disabled={isPending || acceptedCount === 0}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background py-3 text-sm font-medium disabled:opacity-50">
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Créer les {acceptedCount} élément{acceptedCount > 1 ? 's' : ''} validé{acceptedCount > 1 ? 's' : ''}
      </button>
    </div>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Wrench; children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />{children}
    </h3>
  )
}
