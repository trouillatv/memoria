'use client'

// Écran de curation des décisions détectées dans un compte-rendu.
// Regroupé par CORPS D'ÉTAT (Adrien retrouve sa réunion de chantier).
// L'humain accepte / édite / rejette. Pour une 'action' : garder / planifier.
// Vue minimale "Réunion #N" : rappel des actions encore ouvertes.

import { useMemo, useState, useTransition } from 'react'
import {
  Check, X, Loader2, Wrench, AlertTriangle, Eye, BookOpen,
  Building2, CalendarClock, ClipboardList, FileCheck2, ListTodo,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DbSiteAction, DbSiteReportProposal, SiteReportProposalType } from '@/types/db'
import { curateProposalAction, createValidatedProposalsAction } from './report-actions'

interface Mission { id: string; name: string }

interface Props {
  reportId: string
  proposals: DbSiteReportProposal[]
  existingMissions: Mission[]
  meetingNumber: number
  openActions: DbSiteAction[]
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
  reportId, proposals, existingMissions, meetingNumber, openActions, onDone,
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
  const [isPending, startTransition] = useTransition()

  function patch(id: string, p: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  // Regroupement par corps d'état (ordre stable d'apparition)
  const groups = useMemo(() => {
    const map = new Map<string, DbSiteReportProposal[]>()
    for (const p of proposals) {
      const key = (rows[p.id]?.corps_etat || p.corps_etat || '').trim() || 'Général'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries())
  }, [proposals, rows])

  const acceptedCount = Object.values(rows).filter((r) => r.accepted).length

  function submit() {
    startTransition(async () => {
      // 1. Persister la curation de chaque proposition
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
          if (
            (p.type === 'intervention') ||
            (p.type === 'action' && r.actionOutcome === 'intervention')
          ) {
            payloadPatch.mission_choice =
              r.missionMode === 'existing' && r.missionId
                ? { mode: 'existing', mission_id: r.missionId }
                : { mode: 'new', new_mission_name: r.newMissionName.slice(0, 120) }
          }
          fd.set('payload_patch', JSON.stringify(payloadPatch))
          return curateProposalAction(fd)
        }),
      )
      // 2. Matérialiser les éléments acceptés
      const res = await createValidatedProposalsAction(reportId)
      if (res.ok) {
        toast.success(`${res.created} élément${res.created > 1 ? 's' : ''} créé${res.created > 1 ? 's' : ''}`)
        onDone({ created: res.created, hasTomorrowIntervention: res.hasTomorrowIntervention })
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* En-tête Réunion #N + rappel des actions ouvertes */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Réunion chantier #{meetingNumber}
        </div>
        {openActions.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
              ⚠ {openActions.length} action{openActions.length > 1 ? 's' : ''} encore ouverte{openActions.length > 1 ? 's' : ''}
            </p>
            <ul className="mt-1 space-y-0.5">
              {openActions.slice(0, 5).map((a) => (
                <li key={a.id} className="text-xs text-muted-foreground truncate">
                  • {a.corps_etat ? `[${a.corps_etat}] ` : ''}{a.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {proposals.length} décision{proposals.length > 1 ? 's' : ''} détectée{proposals.length > 1 ? 's' : ''}.
        Décochez ce qui ne doit pas être créé.
      </p>

      {/* Groupes par corps d'état */}
      <div className="space-y-4">
        {groups.map(([corps, items]) => (
          <section key={corps}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Wrench className="h-3 w-3" />
              {corps}
              <span className="text-muted-foreground/60">({items.length})</span>
            </h3>
            <div className="space-y-2">
              {items.map((p) => {
                const r = rows[p.id]
                const meta = TYPE_META[p.type]
                const Icon = meta.icon
                const showMission =
                  p.type === 'intervention' || (p.type === 'action' && r.actionOutcome === 'intervention')
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 transition-opacity ${r.accepted ? '' : 'opacity-50'}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.tone}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => patch(p.id, { accepted: !r.accepted })}
                        className={`ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md border ${
                          r.accepted ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-background text-muted-foreground'
                        }`}
                        aria-label={r.accepted ? 'Accepté' : 'Rejeté'}
                      >
                        {r.accepted ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    <textarea
                      value={r.short_label}
                      onChange={(e) => patch(p.id, { short_label: e.target.value })}
                      rows={2}
                      maxLength={140}
                      className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {p.rationale && (
                      <p className="mt-1 text-[10px] italic text-muted-foreground/70 border-l-2 border-muted pl-2">
                        « {p.rationale} »
                      </p>
                    )}

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        value={r.corps_etat}
                        onChange={(e) => patch(p.id, { corps_etat: e.target.value })}
                        placeholder="Corps d'état"
                        className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <input
                        value={r.assigned_to}
                        onChange={(e) => patch(p.id, { assigned_to: e.target.value })}
                        placeholder="Responsable pressenti"
                        className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    {/* Action : devenir quoi ? */}
                    {p.type === 'action' && (
                      <div className="mt-2 flex items-center gap-1 text-xs">
                        {(['keep', 'intervention', 'mission'] as const).map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => patch(p.id, { actionOutcome: o })}
                            className={`rounded-md border px-2 py-1 ${
                              r.actionOutcome === o ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {o === 'keep' ? 'Garder' : o === 'intervention' ? 'Planifier' : 'Mission'}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Intervention : date + mission */}
                    {showMission && (
                      <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-2">
                        <input
                          type="date"
                          value={r.scheduledFor}
                          onChange={(e) => patch(p.id, { scheduledFor: e.target.value })}
                          className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        {existingMissions.length > 0 && (
                          <div className="flex items-center gap-1 text-xs">
                            <button
                              type="button"
                              onClick={() => patch(p.id, { missionMode: 'existing' })}
                              className={`rounded-md border px-2 py-1 ${r.missionMode === 'existing' ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'}`}
                            >
                              Mission existante
                            </button>
                            <button
                              type="button"
                              onClick={() => patch(p.id, { missionMode: 'new' })}
                              className={`rounded-md border px-2 py-1 ${r.missionMode === 'new' ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'}`}
                            >
                              Nouvelle
                            </button>
                          </div>
                        )}
                        {r.missionMode === 'existing' && existingMissions.length > 0 ? (
                          <select
                            value={r.missionId}
                            onChange={(e) => patch(p.id, { missionId: e.target.value })}
                            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                          >
                            {existingMissions.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={r.newMissionName}
                            onChange={(e) => patch(p.id, { newMissionName: e.target.value })}
                            placeholder="Nom de la nouvelle mission"
                            className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isPending || acceptedCount === 0}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background py-3 text-sm font-medium disabled:opacity-50"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Créer les {acceptedCount} élément{acceptedCount > 1 ? 's' : ''} validé{acceptedCount > 1 ? 's' : ''}
      </button>
    </div>
  )
}
