'use client'

import { useMemo, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Loader2, Plus, Search, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createPointSubjectAction,
  curatePointSubjectAction,
  detachPointSubjectAction,
} from '@/app/(dashboard)/sites/[id]/tracked-point-subject-curation-actions'
import type { SubjectPickerItem } from '@/lib/db/canonical-subject-life'
import { cn } from '@/lib/utils'

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
  if (s.status !== 'active') bits.push(s.status)
  return bits.join(' - ')
}

type Mode = 'move' | 'create' | 'detach'

export function PointSubjectCurationControl({
  siteId,
  pointId,
  currentSubjectId,
  currentSubjectLabel,
  subjects,
  isManual,
  curationKind,
}: {
  siteId: string
  pointId: string
  currentSubjectId: string | null
  currentSubjectLabel: string | null
  subjects: SubjectPickerItem[]
  isManual: boolean
  curationKind: 'target_subject' | 'detached' | 'created_subject' | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('move')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SubjectPickerItem | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const eligible = useMemo(
    () => subjects.filter((s) => s.status === 'active' && s.id !== currentSubjectId),
    [currentSubjectId, subjects],
  )

  const filtered = useMemo(() => {
    if (query.trim().length < 2) return eligible.slice(0, 8)
    return eligible.filter((s) => subjectMatches(s, query)).slice(0, 10)
  }, [eligible, query])

  const duplicateHint = useMemo(() => {
    const label = newLabel.trim()
    if (!label) return null
    return eligible.find((s) => normalize(s.label) === normalize(label)) ?? null
  }, [eligible, newLabel])

  function reset() {
    setOpen(false)
    setMode('move')
    setQuery('')
    setSelected(null)
    setNewLabel('')
    setReason('')
    setError(null)
  }

  function submitMove() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const result = await curatePointSubjectAction({
        siteId,
        trackedPointId: pointId,
        targetCanonicalSubjectId: selected.id,
        currentCanonicalSubjectId: currentSubjectId,
        reason,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(result.code === 'no_op' ? 'Sujet deja a jour' : 'Sujet du Point mis a jour')
      reset()
      router.refresh()
    })
  }

  function submitCreate() {
    const label = newLabel.trim()
    if (!label || duplicateHint) return
    setError(null)
    startTransition(async () => {
      const result = await createPointSubjectAction({
        siteId,
        trackedPointId: pointId,
        label,
        reason,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success('Sujet cree et rattache au Point')
      reset()
      router.refresh()
    })
  }

  function submitDetach() {
    setError(null)
    startTransition(async () => {
      const result = await detachPointSubjectAction({
        siteId,
        trackedPointId: pointId,
        currentCanonicalSubjectId: currentSubjectId,
        reason,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(result.code === 'no_op' ? 'Point deja sans sujet manuel' : 'Point mis sans sujet')
      reset()
      router.refresh()
    })
  }

  const manualLabel = curationKind === 'detached' ? 'Sans sujet - decision manuelle' : 'Sujet defini manuellement'

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        {isManual && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
            {manualLabel}
          </span>
        )}
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setMode('move') }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {open && mode === 'move' ? <X className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
          Changer de sujet
        </button>
        <button
          type="button"
          onClick={() => { setOpen(true); setMode('create'); setSelected(null); setError(null) }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Creer un nouveau sujet
        </button>
        {currentSubjectId && (
          <button
            type="button"
            onClick={() => { setOpen(true); setMode('detach'); setSelected(null); setError(null) }}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <Unlink className="h-3.5 w-3.5" />
            Mettre sans sujet
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <div className="text-[12px] text-muted-foreground">
            Sujet actuel : <span className="font-medium text-foreground">{currentSubjectLabel ?? 'Sans sujet'}</span>
          </div>

          {mode === 'move' && (
            <>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelected(null); setError(null) }}
                  placeholder="Rechercher un sujet existant..."
                  className="h-8 w-full rounded-md border bg-background pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <ul className="max-h-56 overflow-y-auto rounded-md border">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-[12.5px] text-muted-foreground">Aucun sujet existant correspondant</li>
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
                <ConfirmationBox
                  text={<>Deplacer ce Point vers <span className="font-medium">{selected.label}</span> ?</>}
                  reason={reason}
                  setReason={setReason}
                  error={error}
                  pending={pending}
                  submitLabel="Confirmer"
                  onSubmit={submitMove}
                  onCancel={reset}
                />
              )}
            </>
          )}

          {mode === 'create' && (
            <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
              <label className="block text-[12px] font-medium">Nom du sujet</label>
              <input
                value={newLabel}
                onChange={(e) => { setNewLabel(e.target.value); setError(null) }}
                maxLength={180}
                placeholder={currentSubjectLabel ?? 'Nom du nouveau sujet'}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              {duplicateHint && (
                <p className="text-[12px] text-amber-700">
                  Un sujet proche existe deja : <span className="font-medium">{duplicateHint.label}</span>. Utilise plutot Changer de sujet.
                </p>
              )}
              <ReasonBox reason={reason} setReason={setReason} />
              {error && <p className="text-[12px] text-red-600">{error}</p>}
              <ActionButtons pending={pending} submitLabel="Creer et rattacher" onSubmit={submitCreate} onCancel={reset} disabled={!newLabel.trim() || Boolean(duplicateHint)} />
            </div>
          )}

          {mode === 'detach' && (
            <ConfirmationBox
              text="Ce Point ne sera plus rattache a un Sujet. Les informations et objets associes au Point seront conserves."
              reason={reason}
              setReason={setReason}
              error={error}
              pending={pending}
              submitLabel="Mettre sans sujet"
              onSubmit={submitDetach}
              onCancel={reset}
            />
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

function ConfirmationBox({
  text,
  reason,
  setReason,
  error,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  text: ReactNode
  reason: string
  setReason: (value: string) => void
  error: string | null
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
      <p className="text-[12px] leading-snug">{text}</p>
      <ReasonBox reason={reason} setReason={setReason} />
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <ActionButtons pending={pending} submitLabel={submitLabel} onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  )
}
