'use client'

// Reconstruction de réunion de chantier (pas un résumé).
// 6 blocs : Présents · Comparaison réunion précédente · Corps d'état ·
// Décisions (routées) · Risques & dépendances · Échéances.
// L'humain valide tout : rien n'est créé/clôturé sans clic.

import { useMemo, useState, useTransition } from 'react'
import {
  Check, X, Loader2, Wrench, AlertTriangle, Eye, BookOpen, Users,
  Building2, CalendarClock, ClipboardList, FileCheck2, ListTodo,
  CheckCircle2, CircleDot, Sparkle, GitBranch, ShieldAlert,
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
  siteId: string
  proposals: DbSiteReportProposal[]
  existingMissions: Mission[]
  meetingNumber: number
  openActions: DbSiteAction[]
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

const RISK_META: Record<SiteReportRisk['kind'], { label: string; icon: typeof GitBranch; tone: string }> = {
  dependency:  { label: 'Dépendance', icon: GitBranch,   tone: 'text-purple-700 bg-purple-50 border-purple-200' },
  preparation: { label: 'Préparation', icon: ShieldAlert, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  vigilance:   { label: 'Vigilance',  icon: Eye,         tone: 'text-orange-700 bg-orange-50 border-orange-200' },
  risk:        { label: 'Risque',     icon: AlertTriangle, tone: 'text-red-700 bg-red-50 border-red-200' },
}

interface RowState {
  accepted: boolean
  short_label: string
  corps_etat: string
  assigned_to: string
  actionOutcome: 'keep' | 'intervention' | 'mission'
  scheduledFor: string
  missionMode: 'new' | 'existing'
  missionId: string
  newMissionName: string
}

export function SiteReportCuration({
  reportId, siteId, proposals, existingMissions, meetingNumber,
  openActions, participants, risks, priorUpdates, onDone,
}: Props) {
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

  // Comparaison réunion : done vs still_open. Les actions ouvertes non couvertes
  // par l'IA restent "toujours ouvertes".
  const updatedIds = new Set(priorUpdates.map((u) => u.actionId))
  const doneUpdates = priorUpdates.filter((u) => u.status === 'done')
  const stillOpenFromUpdates = priorUpdates.filter((u) => u.status === 'still_open')
  const stillOpenUntouched = openActions.filter((a) => !updatedIds.has(a.id))

  const acceptedCount = Object.values(rows).filter((r) => r.accepted).length

  function markDone(actionId: string) {
    startTransition(async () => {
      const res = await markPriorActionDoneAction(actionId)
      if (res.ok) { setDoneActions((s) => new Set(s).add(actionId)); toast.success('Action clôturée') }
      else toast.error(res.error)
    })
  }

  function createVigilance(idx: number, label: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('site_id', siteId)
      fd.set('label', label)
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

  const hasComparison = doneUpdates.length + stillOpenFromUpdates.length + stillOpenUntouched.length > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        Réunion chantier #{meetingNumber}
        <span className="text-xs font-normal text-muted-foreground">— reconstruction</span>
      </div>

      {/* 👥 PRÉSENTS */}
      {participants.length > 0 && (
        <section>
          <SectionTitle icon={Users}>Présents détectés</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {participants.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  p.kind === 'control' ? 'bg-rose-500' : p.kind === 'company' ? 'bg-violet-500' : 'bg-sky-500'
                }`} />
                {p.name}
                {p.role && <span className="text-muted-foreground/70">· {p.role}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 🔄 COMPARAISON RÉUNION PRÉCÉDENTE */}
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
                      className="shrink-0 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">
                      Clôturer
                    </button>
                  )}
                </div>
              )
            })}
            {[...stillOpenFromUpdates.map((u) => ({ id: u.actionId, title: u.title })),
              ...stillOpenUntouched.map((a) => ({ id: a.id, title: a.title }))].map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-xs">
                <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span className="flex-1"><span className="font-medium text-amber-800">Toujours ouvert&nbsp;:</span> {a.title}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
              <Sparkle className="h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span><span className="font-medium text-foreground">{proposals.length} nouvelle{proposals.length > 1 ? 's' : ''} décision{proposals.length > 1 ? 's' : ''}</span> ce {meetingNumber === 1 ? 'compte-rendu' : 'jour'}</span>
            </div>
          </div>
        </section>
      )}

      {/* 🏗 CORPS D'ÉTAT (résumé) */}
      {groups.length > 0 && (
        <section>
          <SectionTitle icon={Wrench}>Corps d&apos;état concernés</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {groups.map(([corps, items]) => (
              <span key={corps} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
                {corps} <span className="text-muted-foreground/60">({items.length})</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 📋 DÉCISIONS */}
      <section>
        <SectionTitle icon={ListTodo}>
          Décisions détectées
          <span className="ml-1 text-xs font-normal text-muted-foreground">— décochez ce qui ne doit pas être créé</span>
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
                      {p.rationale && (
                        <p className="mt-1 text-[10px] italic text-muted-foreground/70 border-l-2 border-muted pl-2">« {p.rationale} »</p>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input value={r.corps_etat} onChange={(e) => patch(p.id, { corps_etat: e.target.value })}
                          placeholder="Corps d'état" className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                        <input value={r.assigned_to} onChange={(e) => patch(p.id, { assigned_to: e.target.value })}
                          placeholder="Responsable pressenti" className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                      </div>
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

      {/* ⚠️ RISQUES & DÉPENDANCES */}
      {risks.length > 0 && (
        <section>
          <SectionTitle icon={AlertTriangle}>Risques &amp; dépendances</SectionTitle>
          <div className="space-y-2">
            {risks.map((rk, i) => {
              const meta = RISK_META[rk.kind]
              const Icon = meta.icon
              const created = vigilanceCreated.has(i)
              return (
                <div key={i} className={`rounded-lg border p-2.5 ${meta.tone}`}>
                  <div className="flex items-start gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wide">{meta.label}</span>
                      <p className="text-xs leading-snug">{rk.label}</p>
                      {rk.rationale && <p className="text-[10px] italic opacity-70 mt-0.5">« {rk.rationale} »</p>}
                    </div>
                    {!created ? (
                      <button type="button" onClick={() => createVigilance(i, rk.label)} disabled={isPending}
                        className="shrink-0 rounded border bg-white/70 px-1.5 py-0.5 text-[10px] font-medium hover:bg-white">
                        + Vigilance
                      </button>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium inline-flex items-center gap-0.5"><Check className="h-3 w-3" />Ajouté</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
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
