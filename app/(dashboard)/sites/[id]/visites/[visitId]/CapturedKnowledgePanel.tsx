'use client'

import { useState, useTransition } from 'react'
import { Check, Lightbulb, Link2, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { addKnowledgeAction } from './knowledge-actions'
import type { CapturedKnowledgeRow } from '@/lib/db/captured-knowledge'

type Kind = 'promise' | 'risk' | 'context' | 'missing_document' | 'attention' | 'other'

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'promise', label: 'Promesse' },
  { value: 'risk', label: 'Risque' },
  { value: 'attention', label: "Point d'attention" },
  { value: 'missing_document', label: 'Document manquant' },
  { value: 'context', label: 'Contexte' },
  { value: 'other', label: 'Autre' },
]
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((kind) => [kind.value, kind.label]))

export function CapturedKnowledgePanel({
  siteId,
  reportId,
  openSubjects,
  initial,
}: {
  siteId: string
  reportId: string
  openSubjects: Array<{ id: string; name: string }>
  initial: CapturedKnowledgeRow[]
}) {
  const [items, setItems] = useState<CapturedKnowledgeRow[]>(initial)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Kind>('promise')
  const [subjectId, setSubjectId] = useState<string>(openSubjects[0]?.id ?? '')
  const [pending, start] = useTransition()

  const subjectName = (id: string | null) => openSubjects.find((subject) => subject.id === id)?.name ?? null

  function submit() {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    start(async () => {
      const result = await addKnowledgeAction({
        site_id: siteId,
        report_id: reportId,
        kind,
        title: cleanTitle,
        subject_id: subjectId || null,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setItems((previous) => [{
        id: result.id,
        site_id: siteId,
        source_type: 'visit',
        source_id: reportId,
        kind,
        title: cleanTitle,
        body: null,
        status: 'active',
        resolution: null,
        resolved_at: null,
        subject_id: subjectId || null,
        action_id: null,
        zone_id: null,
        source_capture_ids: [],
        created_at: new Date().toISOString(),
      }, ...previous])
      setTitle('')
      setOpen(false)
      toast.success('Information ajoutee', { duration: 1200 })
    })
  }

  return (
    <section className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4" /> Memoire du chantier{items.length > 0 ? ` (${items.length})` : ''}
        </h3>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground">
            <Plus className="h-4 w-4" /> Ajouter une information
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Cette visite vous a appris quelque chose qui sera encore utile dans plusieurs semaines ? Ajoutez-le a la memoire du chantier.
      </p>

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span className="min-w-0 flex-1">{item.title}</span>
              </div>
              {subjectName(item.subject_id) ? (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300">
                  <Link2 className="h-3 w-3" /> {subjectName(item.subject_id)}
                </div>
              ) : (
                <div className="mt-1 text-[11px] italic text-amber-700/80">Non reliee au chantier.</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            autoFocus
            placeholder="Ex : Le BET doit envoyer les plans mardi"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              {KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <label className="flex w-full min-w-0 items-center gap-1.5 text-sm sm:w-auto sm:flex-1">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 py-1.5 text-sm">
                <option value="">Relier a un point...</option>
                {openSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending || title.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border-2 border-foreground bg-foreground px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
