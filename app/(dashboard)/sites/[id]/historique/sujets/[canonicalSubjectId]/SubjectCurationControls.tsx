'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GitMerge, Loader2, Pencil, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import type { SubjectPickerItem } from '@/lib/db/canonical-subject-life'
import { cn } from '@/lib/utils'
import { mergeCanonicalSubjectsAction, renameCanonicalSubjectAction } from './subject-curation-actions'

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function subjectMatches(s: SubjectPickerItem, q: string) {
  const n = normalize(q)
  if (normalize(s.label).includes(n)) return true
  return s.aliases.some((a) => normalize(a).includes(n))
}

function subjectMeta(s: SubjectPickerItem) {
  const bits = []
  if (s.family) bits.push(s.family)
  if (s.pvCount > 0) bits.push(`${s.pvCount} PV`)
  if (s.coOccurrenceCount > 0) bits.push(`${s.coOccurrenceCount} PV commun${s.coOccurrenceCount > 1 ? 's' : ''}`)
  return bits.join(' - ')
}

export function SubjectCurationControls({
  siteId,
  subjectId,
  label,
  candidates,
}: {
  siteId: string
  subjectId: string
  label: string
  candidates: SubjectPickerItem[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'closed' | 'rename' | 'merge'>('closed')
  const [draft, setDraft] = useState(label)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SubjectPickerItem | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const eligible = useMemo(
    () => candidates.filter((s) => s.status === 'active' && s.id !== subjectId),
    [candidates, subjectId],
  )

  const filtered = useMemo(() => {
    if (query.trim().length < 2) return eligible.slice(0, 8)
    return eligible.filter((s) => subjectMatches(s, query)).slice(0, 10)
  }, [eligible, query])

  const duplicateLabel = useMemo(() => {
    const value = draft.trim()
    if (!value || normalize(value) === normalize(label)) return null
    return eligible.find((s) => normalize(s.label) === normalize(value)) ?? null
  }, [draft, eligible, label])

  function reset() {
    setMode('closed')
    setDraft(label)
    setQuery('')
    setSelected(null)
    setReason('')
    setError(null)
  }

  function submitRename() {
    const value = draft.trim()
    if (!value || duplicateLabel) return
    setError(null)
    startTransition(async () => {
      const result = await renameCanonicalSubjectAction({
        siteId,
        canonicalSubjectId: subjectId,
        newLabel: value,
        reason,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(result.code === 'no_op' ? 'Nom deja a jour' : 'Sujet renomme')
      reset()
      router.refresh()
    })
  }

  function submitMerge() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const result = await mergeCanonicalSubjectsAction({
        siteId,
        sourceCanonicalSubjectId: subjectId,
        targetCanonicalSubjectId: selected.id,
        reason,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(result.code === 'no_op' ? 'Sujets deja fusionnes' : 'Sujets fusionnes')
      router.push(`/sites/${siteId}/historique/sujets/${selected.id}`)
      router.refresh()
    })
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'rename' ? 'closed' : 'rename'))}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {mode === 'rename' ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          Renommer
        </button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'merge' ? 'closed' : 'merge'))}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {mode === 'merge' ? <X className="h-3.5 w-3.5" /> : <GitMerge className="h-3.5 w-3.5" />}
          Fusionner avec
        </button>
      </div>

      {mode === 'rename' && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <label className="block text-[12px] font-medium">Nouveau nom</label>
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null) }}
            maxLength={180}
            className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {duplicateLabel && (
            <p className="text-[12px] text-amber-700">
              Un autre sujet porte deja ce nom : <span className="font-medium">{duplicateLabel.label}</span>.
            </p>
          )}
          <ReasonBox reason={reason} setReason={setReason} />
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <ActionButtons pending={pending} submitLabel="Renommer" onSubmit={submitRename} onCancel={reset} disabled={!draft.trim() || Boolean(duplicateLabel)} />
        </div>
      )}

      {mode === 'merge' && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="text-[12px] text-muted-foreground">
            Les Points, objets metier, occurrences et preuves resteront conserves dans le sujet cible.
          </p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); setError(null) }}
              placeholder="Rechercher le sujet cible..."
              className="h-8 w-full rounded-md border bg-background pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto rounded-md border">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12.5px] text-muted-foreground">Aucun sujet cible correspondant</li>
            ) : (
              filtered.map((s) => {
                const active = selected?.id === s.id
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected(s); setError(null) }}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/60',
                        active && 'bg-sky-50 text-sky-900 dark:bg-sky-950/25 dark:text-sky-100',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-snug">{s.label}</span>
                        {subjectMeta(s) && <span className="block text-[11px] text-muted-foreground">{subjectMeta(s)}</span>}
                      </span>
                      {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          {selected && (
            <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
              <p className="text-[12px] leading-snug">
                Fusionner <span className="font-medium">{label}</span> dans <span className="font-medium">{selected.label}</span> ?
              </p>
              <ReasonBox reason={reason} setReason={setReason} />
              {error && <p className="text-[12px] text-red-600">{error}</p>}
              <ActionButtons pending={pending} submitLabel="Fusionner" onSubmit={submitMerge} onCancel={reset} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReasonBox({ reason, setReason }: { reason: string; setReason: (value: string) => void }) {
  return (
    <textarea
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      rows={2}
      maxLength={500}
      placeholder="Motif facultatif"
      className="w-full rounded-md border bg-background px-2 py-1.5 text-[12.5px] outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function ActionButtons({
  pending,
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
}: {
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || disabled}
        className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-md border px-2.5 py-1 text-[12px] hover:bg-muted/60 disabled:opacity-50"
      >
        Annuler
      </button>
    </div>
  )
}
