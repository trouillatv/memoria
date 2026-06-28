'use client'

import { useState, useTransition } from 'react'
import { Lightbulb, Link2, Check, Loader2, Plus } from 'lucide-react'
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
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))

/**
 * « À retenir » — capter une INFO UTILE (captured_knowledge) au débrief. Tout n'est
 * pas une action : une promesse, un risque, un piège, un doc manquant… La règle :
 * on essaie toujours de la RELIER (à un point suivi) pour qu'elle ressorte plus tard.
 */
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
  const [open, setOpen] = useState(initial.length === 0)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Kind>('promise')
  const [subjectId, setSubjectId] = useState<string>(openSubjects[0]?.id ?? '')
  const [pending, start] = useTransition()

  const subjectName = (id: string | null) => openSubjects.find((s) => s.id === id)?.name ?? null

  function submit() {
    const t = title.trim()
    if (!t) return
    start(async () => {
      const r = await addKnowledgeAction({
        site_id: siteId,
        report_id: reportId,
        kind,
        title: t,
        subject_id: subjectId || null,
      })
      if (!r.ok) { toast.error(r.error); return }
      // Optimiste : on ajoute en tête, on réinitialise le titre.
      setItems((prev) => [{
        id: r.id, site_id: siteId, source_type: 'visit', source_id: reportId,
        kind, title: t, body: null, status: 'active',
        subject_id: subjectId || null, action_id: null, zone_id: null,
        source_capture_ids: [], created_at: new Date().toISOString(),
      }, ...prev])
      setTitle('')
      toast.success('Info retenue', { duration: 1200 })
    })
  }

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Lightbulb className="h-4 w-4" /> À retenir{items.length > 0 ? ` (${items.length})` : ''}
        </h2>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground">
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tout n&apos;est pas une action : une promesse entendue, un risque, un piège, un document manquant… On la relie à un point pour qu&apos;elle ressorte plus tard.
      </p>

      {/* Liste de ce qui est déjà retenu pour cette visite. */}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((k) => (
            <li key={k.id} className="rounded-lg border bg-background px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {KIND_LABEL[k.kind] ?? k.kind}
                </span>
                <span className="min-w-0 flex-1">{k.title}</span>
              </div>
              {subjectName(k.subject_id) ? (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300">
                  <Link2 className="h-3 w-3" /> {subjectName(k.subject_id)}
                </div>
              ) : (
                <div className="mt-1 text-[11px] italic text-amber-700/80">Non reliée — moins susceptible de ressortir.</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Formulaire minimal. */}
      {open && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            autoFocus
            placeholder="Ex : Le BET doit envoyer les plans mardi"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <label className="flex w-full min-w-0 items-center gap-1.5 text-sm sm:w-auto sm:flex-1">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 py-1.5 text-sm">
                <option value="">Relier à un point…</option>
                {openSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          {!subjectId && (
            <p className="text-[11px] text-amber-700/80">Sans lien, l&apos;info ressortira mal plus tard — relie-la si tu peux.</p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending || title.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border-2 border-foreground bg-foreground px-3 py-1.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} À retenir
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
