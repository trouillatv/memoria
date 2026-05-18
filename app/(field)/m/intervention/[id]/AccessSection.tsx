'use client'

// Bloc "Accès site" mobile — prise / restitution / incident.
// Doctrine : sobre, jamais bloquant, aucun nom de personne affiché.
// N'apparaît que si le site est flaggé requires_access_handover.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, KeyRound, Undo2, AlertTriangle, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { recordAccessEventAction } from './access-actions'
import type {
  DbInterventionAccessEvent,
  AccessEventType,
  AccessEventSource,
} from '@/lib/db/intervention-access-events'
import { formatRelativeShort } from '@/lib/format'

const TYPE_LABEL: Record<AccessEventType, string> = {
  pickup: "Prise d'accès",
  return: 'Restitution',
  incident: "Incident d'accès",
}

const SOURCE_OPTIONS: { value: AccessEventSource; label: string }[] = [
  { value: 'pc_securite', label: 'PC sécurité' },
  { value: 'spi', label: 'SPI / prestataire' },
  { value: 'accueil', label: 'Accueil' },
  { value: 'autre', label: 'Autre' },
]
const SOURCE_LABEL: Record<AccessEventSource, string> = {
  pc_securite: 'PC sécurité',
  spi: 'SPI / prestataire',
  accueil: 'Accueil',
  autre: 'Autre',
}

interface Props {
  interventionId: string
  events: DbInterventionAccessEvent[]
  canCapture: boolean
  needsReturnPrompt: boolean
}

type ModalState =
  | { type: AccessEventType; deferred: boolean }
  | null

export function AccessSection({
  interventionId,
  events,
  canCapture,
  needsReturnPrompt,
}: Props) {
  const router = useRouter()
  const [modal, setModal] = useState<ModalState>(null)
  const [pending, startTransition] = useTransition()
  const [source, setSource] = useState<AccessEventSource>('pc_securite')
  const [note, setNote] = useState('')
  const [requiresReturn, setRequiresReturn] = useState(true)
  const [file, setFile] = useState<File | null>(null)

  function openModal(type: AccessEventType, deferred = false) {
    setSource('pc_securite')
    setNote('')
    setRequiresReturn(true)
    setFile(null)
    setModal({ type, deferred })
  }

  function closeModal() {
    setModal(null)
  }

  function submit() {
    if (!modal) return
    const isIncident = modal.type === 'incident'
    const isDeferredReturn = modal.type === 'return' && modal.deferred
    if ((isIncident || isDeferredReturn) && !note.trim()) {
      toast.error(
        isIncident
          ? "Décrivez brièvement l'incident."
          : 'Une note est obligatoire pour différer la restitution.',
      )
      return
    }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('type', modal.type)
    fd.set('source', source)
    if (note.trim()) fd.set('note', note.trim())
    fd.set('requires_return', String(modal.type === 'pickup' ? requiresReturn : true))
    fd.set('deferred', String(isDeferredReturn))
    if (file) fd.set('file', file)

    startTransition(async () => {
      const r = await recordAccessEventAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Accès documenté', { duration: 1500 })
        closeModal()
        router.refresh()
      }
    })
  }

  return (
    <section aria-labelledby="access-heading" className="space-y-2">
      <h2
        id="access-heading"
        className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2"
      >
        <KeyRound className="h-3 w-3" />
        Accès site
      </h2>

      {events.length > 0 && (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-sm leading-relaxed">
              <span className="font-medium">{TYPE_LABEL[e.type]}</span>
              {' · '}
              <span className="text-muted-foreground">{SOURCE_LABEL[e.source]}</span>
              {e.type === 'return' && e.deferred && (
                <span className="text-muted-foreground"> · différée</span>
              )}
              <span className="text-[10px] text-muted-foreground/60 ml-2">
                ({formatRelativeShort(e.occurred_at)})
              </span>
              {e.photo_id && (
                <Paperclip className="inline h-3 w-3 ml-1 text-muted-foreground/60" />
              )}
              {e.note && (
                <div className="text-sm text-muted-foreground italic whitespace-pre-wrap">
                  {e.note}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Encart clôture — sobre, jamais bloquant. */}
      {canCapture && needsReturnPrompt && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-2">
          <p className="text-foreground">
            Accès pris pour cette intervention. Restitution à documenter.
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => openModal('return')}
              className="w-full rounded-lg border bg-card px-3 py-2 text-sm active:bg-muted/40"
            >
              Documenter la restitution
            </button>
            <button
              type="button"
              onClick={() => openModal('incident')}
              className="w-full rounded-lg border bg-card px-3 py-2 text-sm active:bg-muted/40"
            >
              Signaler un incident
            </button>
            <button
              type="button"
              onClick={() => openModal('return', true)}
              className="w-full rounded-lg px-3 py-2 text-sm text-muted-foreground underline active:text-foreground"
            >
              Continuer sans restitution (note requise)
            </button>
          </div>
        </div>
      )}

      {canCapture && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <AccessBtn icon={<KeyRound className="h-4 w-4" />} label="Prise" onClick={() => openModal('pickup')} />
          <AccessBtn icon={<Undo2 className="h-4 w-4" />} label="Restitution" onClick={() => openModal('return')} />
          <AccessBtn
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Incident"
            onClick={() => openModal('incident')}
          />
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
          <header className="sticky top-0 z-10 bg-background border-b">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={pending}
                className="inline-flex items-center gap-1 text-sm active:text-muted-foreground"
                style={{ minHeight: 44 }}
              >
                <ArrowLeft className="h-4 w-4" />
                Retour
              </button>
              <span className="text-sm font-semibold">{TYPE_LABEL[modal.type]}</span>
              <span className="w-12" aria-hidden />
            </div>
          </header>

          <div className="p-4 space-y-5 max-w-md mx-auto">
            <div className="space-y-2">
              <span className="text-sm font-medium">Source de l&apos;accès</span>
              <div className="space-y-2">
                {SOURCE_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSource(s.value)}
                    disabled={pending}
                    className={`w-full rounded-xl border p-3 text-left text-base active:bg-muted/40 ${
                      source === s.value ? 'border-foreground bg-muted/40' : 'border-border bg-card'
                    }`}
                    style={{ minHeight: 52 }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {modal.type === 'pickup' && (
              <label className="flex items-center gap-3 text-base">
                <input
                  type="checkbox"
                  checked={requiresReturn}
                  onChange={(e) => setRequiresReturn(e.target.checked)}
                  disabled={pending}
                  className="h-5 w-5"
                />
                Restitution attendue
                <span className="text-xs text-muted-foreground">
                  (décocher si badge jetable / conservé)
                </span>
              </label>
            )}

            <div className="space-y-2">
              <label htmlFor="access-note" className="text-sm font-medium">
                Note
                {(modal.type === 'incident' || (modal.type === 'return' && modal.deferred))
                  ? ' (obligatoire)'
                  : ' (optionnel)'}
              </label>
              <textarea
                id="access-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={280}
                disabled={pending}
                className="w-full rounded-lg border p-3 text-base resize-none"
                placeholder={
                  modal.type === 'incident'
                    ? 'Ex. PC sécurité fermé à 18h, badge non remis…'
                    : 'Précision éventuelle…'
                }
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="access-photo" className="text-sm font-medium">
                Photo du trousseau / badge (optionnelle)
              </label>
              <input
                id="access-photo"
                type="file"
                accept="image/*"
                capture="environment"
                disabled={pending}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="w-full inline-flex items-center justify-center rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:bg-foreground/90 disabled:opacity-50"
              style={{ minHeight: 64 }}
            >
              {pending ? 'Envoi…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function AccessBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-center justify-center gap-1 rounded-xl border bg-card px-2 py-3 text-xs font-medium active:bg-muted/40"
      style={{ minHeight: 64 }}
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}
