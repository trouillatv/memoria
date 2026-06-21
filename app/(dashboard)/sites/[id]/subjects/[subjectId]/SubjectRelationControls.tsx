'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowRight, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createSubjectRelationAction, deleteSubjectRelationAction } from '../actions'
import type { SubjectRelationLite, RelationImportance } from '@/lib/db/subject-relations'

interface Props {
  siteId: string
  subjectId: string
  subjectName: string
  blocks: SubjectRelationLite[]      // ce sujet bloque…
  blockedBy: SubjectRelationLite[]   // …est bloqué par (en attente de)
  candidates: { id: string; name: string }[]   // autres sujets bloquables
}

function ImportanceBadge({ importance }: { importance: RelationImportance }) {
  return importance === 'critique'
    ? <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">critique</span>
    : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">normal</span>
}

export function SubjectRelationControls({ siteId, subjectId, subjectName, blocks, blockedBy, candidates }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [importance, setImportance] = useState<RelationImportance>('normal')

  function add() {
    if (!target || !reason.trim()) return
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('subjectId', subjectId)
    fd.set('targetSubjectId', target); fd.set('reason', reason.trim()); fd.set('importance', importance)
    start(async () => {
      const r = await createSubjectRelationAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Dépendance ajoutée')
      setTarget(''); setReason(''); setImportance('normal')
      router.refresh()
    })
  }

  function remove(relationId: string) {
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('subjectId', subjectId); fd.set('relationId', relationId)
    start(async () => {
      const r = await deleteSubjectRelationAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Dépendance retirée')
      router.refresh()
    })
  }

  const row = (rel: SubjectRelationLite, prefix: string) => (
    <li key={rel.relationId} className="flex items-start gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground">{prefix} </span>
        <Link href={`/sites/${siteId}/subjects/${rel.subjectId}`} className="font-medium hover:underline">{rel.subjectName}</Link>
        {' '}<ImportanceBadge importance={rel.importance} />
        <span className="block text-[11px] text-muted-foreground">Raison : {rel.reason}</span>
      </span>
      <button type="button" disabled={pending} onClick={() => remove(rel.relationId)}
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-rose-600" aria-label="Retirer la dépendance">
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <ArrowRight className="h-4 w-4 text-muted-foreground" /> Dépendances
      </h2>

      {blocks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Ce sujet bloque ({blocks.length})</p>
          <ul className="space-y-1">{blocks.map((r) => row(r, '→'))}</ul>
        </div>
      )}

      {blockedBy.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">En attente de ({blockedBy.length})</p>
          <ul className="space-y-1">{blockedBy.map((r) => row(r, '←'))}</ul>
        </div>
      )}

      {blocks.length === 0 && blockedBy.length === 0 && (
        <p className="text-xs text-muted-foreground/80 italic">Aucune dépendance. Indiquez ce que « {subjectName} » bloque ci-dessous.</p>
      )}

      {/* Ajout — acte humain, raison obligatoire. */}
      {candidates.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">« {subjectName} » bloque…</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={target} disabled={pending} onChange={(e) => setTarget(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-xs max-w-[220px]">
              <option value="">choisir un sujet…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={importance} disabled={pending} onChange={(e) => setImportance(e.target.value as RelationImportance)}
              className="rounded border bg-background px-2 py-1 text-xs">
              <option value="normal">normal</option>
              <option value="critique">critique</option>
            </select>
          </div>
          <input type="text" value={reason} disabled={pending} onChange={(e) => setReason(e.target.value)}
            placeholder="Raison du blocage (obligatoire) — ex. plans CFO manquants"
            className="w-full rounded border bg-background px-2 py-1 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          <button type="button" disabled={pending || !target || !reason.trim()} onClick={add}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter la dépendance
          </button>
        </div>
      )}
    </section>
  )
}
