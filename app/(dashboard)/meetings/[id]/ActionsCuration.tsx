'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ListTodo, Check, X, Clock, Loader2, Pencil, Ban, Repeat } from 'lucide-react'
import {
  acceptActionProposalAction,
  ignoreActionProposalAction,
  updateActionAction,
} from './action-curation-actions'
import { ShareActionsToCompanyButton } from './ShareActionsToCompanyButton'
import { LotStatusList } from './LotStatusList'
import { actionDurationNarration } from '@/lib/actions/health'
import type { DbSiteReportProposal, DbSiteAction } from '@/types/db'
import type { DistributionStatusRow } from '@/lib/db/action-distribution'

const NARRATION_TONE: Record<'bad' | 'warn' | 'muted', string> = {
  bad: 'text-rose-700',
  warn: 'text-amber-700',
  muted: 'text-muted-foreground',
}

interface ActionsCurationProps {
  reportId: string
  siteId: string | null
  pendingProposals: DbSiteReportProposal[]
  actions: DbSiteAction[]
  /** Statut des lots confiés (envoyé → lu → rempli). */
  lots: DistributionStatusRow[]
}

/** Écho de la déclaration externe (entreprise via QR). N'est PAS le statut
 *  interne : c'est « déclaré par l'entreprise », à vérifier par le MOE. */
function ExternalEcho({ action }: { action: DbSiteAction }) {
  if (!action.ext_status) return null
  const done = action.ext_status === 'done'
  return (
    <span
      title={action.ext_comment ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
      }`}
    >
      {done ? <Check className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
      {done ? 'Déclaré fait' : 'Déclaré bloqué'}
      {action.ext_by ? ` · ${action.ext_by}` : ''}
      {action.ext_photo_path ? ' · photo' : ''}
    </span>
  )
}

type DueStatus = 'explicit' | 'estimated' | null

function statusFromBadge(due: string, badge: boolean): DueStatus {
  if (!due) return null
  return badge ? 'estimated' : 'explicit'
}

function ProposalRow({ reportId, proposal }: { reportId: string; proposal: DbSiteReportProposal }) {
  const router = useRouter()
  const payload = proposal.payload as { suggested_date?: string | null; due_date_kind?: string | null }
  const seedDate = typeof payload?.suggested_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.suggested_date)
    ? payload.suggested_date : ''
  const [title, setTitle] = useState(proposal.short_label)
  const [assignedTo, setAssignedTo] = useState(proposal.assigned_to ?? '')
  const [due, setDue] = useState(seedDate)
  // « à confirmer » par défaut si l'IA a proposé une date relative.
  const [aConfirmer, setAConfirmer] = useState(payload?.due_date_kind === 'relative')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function accept() {
    setError(null)
    start(async () => {
      const res = await acceptActionProposalAction(reportId, proposal.id, {
        title: title.trim(),
        assigned_to: assignedTo.trim() || null,
        corps_etat: proposal.corps_etat,
        due_date: due || null,
        due_date_status: statusFromBadge(due, aConfirmer),
      })
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Échec')
    })
  }
  function ignore() {
    setError(null)
    start(async () => {
      const res = await ignoreActionProposalAction(reportId, proposal.id)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Échec')
    })
  }

  return (
    <li className="rounded-lg border bg-card p-3 space-y-2">
      {proposal.origin === 'reanalysis' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">🎙 Nouveau depuis audio complémentaire</span>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded border px-2 py-1 text-sm font-medium"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          placeholder="Responsable"
          className="rounded border px-2 py-1"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded border px-2 py-1"
        />
        {due && (
          <label className="inline-flex items-center gap-1 text-amber-700">
            <input type="checkbox" checked={aConfirmer} onChange={(e) => setAConfirmer(e.target.checked)} />
            à confirmer
          </label>
        )}
        {proposal.corps_etat && <span className="text-muted-foreground">· {proposal.corps_etat}</span>}
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={pending || !title.trim()}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Accepter
        </button>
        <button
          type="button"
          onClick={ignore}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
        >
          <X className="h-3 w-3" /> Ignorer
        </button>
      </div>
    </li>
  )
}

type ActionKind = 'one_shot' | 'deadline' | 'recurring_until_done'
const KIND_LABEL: Record<ActionKind, string> = {
  one_shot: 'Ponctuelle',
  deadline: 'Pour une échéance',
  recurring_until_done: 'À reprendre jusqu’à clôture',
}

function ActionRow({ reportId, action }: { reportId: string; action: DbSiteAction }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(action.title)
  const [assignedTo, setAssignedTo] = useState(action.assigned_to ?? '')
  const [due, setDue] = useState(action.due_date ?? '')
  const [aConfirmer, setAConfirmer] = useState(action.due_date_status === 'estimated')
  const [kind, setKind] = useState<ActionKind>(action.kind ?? 'one_shot')
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const res = await updateActionAction(reportId, action.id, {
        title: title.trim(),
        assigned_to: assignedTo.trim() || null,
        due_date: due || null,
        due_date_status: statusFromBadge(due, aConfirmer),
        kind,
      })
      if (res.ok) { setEditing(false); router.refresh() }
    })
  }

  // Couleur → phrase : « Ouverte depuis 143 j » plutôt qu'un simple point rouge.
  const narration = actionDurationNarration({
    createdAt: action.created_at,
    status: action.status,
    extStatus: action.ext_status,
    extAt: action.ext_at,
  })

  if (!editing) {
    return (
      <li className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">{action.title}</div>
          {narration && (
            <div className={`mt-0.5 text-xs font-medium ${NARRATION_TONE[narration.tone]}`}>{narration.text}</div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {action.assigned_to && <span>{action.assigned_to}</span>}
            {action.due_date && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />{action.due_date}
                {action.due_date_status === 'estimated' && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>
                )}
              </span>
            )}
            {action.corps_etat && <span>· {action.corps_etat}</span>}
            {action.kind === 'recurring_until_done' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 border border-sky-200">
                <Repeat className="h-2.5 w-2.5" /> jusqu’à clôture
              </span>
            )}
          </div>
          <div className="mt-1"><ExternalEcho action={action} /></div>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </li>
    )
  }

  return (
    <li className="rounded-lg border bg-card p-3 space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border px-2 py-1 text-sm font-medium" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Responsable" className="rounded border px-2 py-1" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded border px-2 py-1" />
        {due && (
          <label className="inline-flex items-center gap-1 text-amber-700">
            <input type="checkbox" checked={aConfirmer} onChange={(e) => setAConfirmer(e.target.checked)} /> à confirmer
          </label>
        )}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ActionKind)}
          title="Type d'action"
          className="rounded border px-2 py-1 text-xs"
        >
          {(Object.keys(KIND_LABEL) as ActionKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Enregistrer
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded border px-2.5 py-1 text-xs hover:bg-muted/40">Annuler</button>
      </div>
    </li>
  )
}

export function ActionsCuration({ reportId, siteId, pendingProposals, actions, lots }: ActionsCurationProps) {
  const visibleActions = actions.filter((a) => a.status !== 'cancelled')
  if (pendingProposals.length === 0 && visibleActions.length === 0) return null

  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <ListTodo className="h-4 w-4 text-muted-foreground" /> Qui fait quoi, pour quand
      </h2>

      {pendingProposals.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions proposées ({pendingProposals.length}) — à valider
          </p>
          <ul className="space-y-2">
            {pendingProposals.map((p) => (
              <ProposalRow key={p.id} reportId={reportId} proposal={p} />
            ))}
          </ul>
        </div>
      )}

      {visibleActions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions validées ({visibleActions.length})
          </p>
          <ul className="space-y-2">
            {visibleActions.map((a) => (
              <ActionRow key={a.id} reportId={reportId} action={a} />
            ))}
          </ul>
          {/* Confier un lot à une entreprise (QR/lien) — capte une déclaration,
              ne gère pas le travail. Seulement si le site est connu. */}
          {siteId && (
            <div className="pt-1">
              <ShareActionsToCompanyButton reportId={reportId} siteId={siteId} actions={visibleActions} />
            </div>
          )}
          <LotStatusList reportId={reportId} lots={lots} />
        </div>
      )}
    </section>
  )
}
