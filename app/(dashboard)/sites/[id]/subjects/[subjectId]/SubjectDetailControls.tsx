'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { setSubjectStatusAction, attachToSubjectAction, renameSubjectAction } from '../actions'
import type { SubjectStatus } from '@/types/db'

type Candidate = { id: string; label: string }
type Kind = 'action' | 'reserve' | 'decision' | 'document' | 'anomaly' | 'added_anomaly'

interface Props {
  siteId: string
  subjectId: string
  name: string
  status: SubjectStatus
  candidates: { actions: Candidate[]; reserves: Candidate[]; decisions: Candidate[]; documents: Candidate[]; anomalies: Candidate[]; addedAnomalies: Candidate[] }
}

const STATUS: { value: SubjectStatus; label: string }[] = [
  { value: 'open', label: 'Ouvert' },
  { value: 'dormant', label: 'En sommeil' },
  { value: 'closed', label: 'Clos' },
]

const ATTACH: { kind: Kind; label: string; key: keyof Props['candidates'] }[] = [
  { kind: 'action', label: 'une action', key: 'actions' },
  { kind: 'reserve', label: 'une réserve', key: 'reserves' },
  { kind: 'decision', label: 'une décision', key: 'decisions' },
  { kind: 'anomaly', label: 'une anomalie', key: 'anomalies' },
  { kind: 'added_anomaly', label: 'une anomalie (séance)', key: 'addedAnomalies' },
  { kind: 'document', label: 'un document', key: 'documents' },
]

export function SubjectDetailControls({ siteId, subjectId, name, status, candidates }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  function rename() {
    const v = draft.trim()
    if (!v || v === name) { setEditing(false); return }
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('subjectId', subjectId); fd.set('name', v)
    start(async () => {
      const r = await renameSubjectAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Point renommé')
      setEditing(false)
      router.refresh()
    })
  }

  function changeStatus(next: SubjectStatus) {
    if (next === status) return
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('subjectId', subjectId); fd.set('status', next)
    start(async () => {
      const r = await setSubjectStatusAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Statut mis à jour')
      router.refresh()
    })
  }

  function attach(kind: Kind, rowId: string) {
    if (!rowId) return
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('subjectId', subjectId); fd.set('kind', kind); fd.set('rowId', rowId)
    start(async () => {
      const r = await attachToSubjectAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Rattaché au sujet')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Nom du point</span>
        {editing ? (
          <span className="inline-flex items-center gap-1.5">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={160} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }}
              className="rounded border bg-background px-2 py-1 text-xs min-w-[200px]" />
            <button type="button" disabled={pending} onClick={rename}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
            <button type="button" onClick={() => { setDraft(name); setEditing(false) }} className="text-xs text-muted-foreground">Annuler</button>
          </span>
        ) : (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted/40">
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Renommer
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Statut</span>
        {STATUS.map((s) => (
          <button key={s.value} type="button" disabled={pending} onClick={() => changeStatus(s.value)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              s.value === status ? 'bg-foreground text-background' : 'bg-background hover:bg-muted/40'
            }`}>
            {s.label}
          </button>
        ))}
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Rattacher</span>
        {ATTACH.map(({ kind, label, key }) => {
          const list = candidates[key]
          if (list.length === 0) return null
          return (
            <select key={kind} disabled={pending} defaultValue=""
              onChange={(e) => { if (e.target.value) { attach(kind, e.target.value); e.target.value = '' } }}
              className="rounded border bg-background px-2 py-1 text-xs max-w-[220px]">
              <option value="">+ {label}…</option>
              {list.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )
        })}
      </div>
    </div>
  )
}
