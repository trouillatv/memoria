'use client'

// Liste des points à lever d'un site, scindée "Ouverts" / "Levés".
// Sobre et descriptif (doctrine : pas d'alerte rouge ; amber pour les ouverts,
// jamais une mesure d'humain). VOCABULAIRE : on dit "lever" / "levé",
// jamais "résolu" (juridiquement dangereux).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardCheck,
  MapPin,
  UserSquare,
  CalendarDays,
  CheckCircle2,
  StickyNote,
  ListTodo,
  FileText,
  Plus,
  Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SiteReserve } from '@/lib/db/site-reserve'
import { liftReserveAction, addCorrectiveActionAction, linkDocumentToReserveAction } from './actions'

export interface ReserveLinkedAction {
  id: string
  title: string
  assignedTo: string | null
  status: string
  dueDate: string | null
}

export interface ReserveLinkedDoc { id: string; filename: string }

export interface ReserveWithPhotos extends SiteReserve {
  photoBeforeUrl: string | null
  photoAfterUrl: string | null
  actions: ReserveLinkedAction[]
  documents: ReserveLinkedDoc[]
}

interface SiteDoc { id: string; filename: string }

const ACTION_STATUS_FR: Record<string, string> = {
  open: 'à faire', planned: 'planifiée', done: 'faite', cancelled: 'annulée',
}

// ---------------------------------------------------------------------------
// Formatage des dates
// ---------------------------------------------------------------------------

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDate(isoDate: string | null): string | null {
  if (!isoDate) return null
  const datePart = isoDate.slice(0, 10)
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  return `${d} ${FR_MONTHS[m - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Vignette photo (URL signée résolue côté serveur)
// ---------------------------------------------------------------------------

function PhotoThumb({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit" title={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="h-28 w-auto rounded-md border object-cover" />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulaire de levée (inline, sur une réserve ouverte)
// ---------------------------------------------------------------------------

function LiftForm({ reserve, siteId }: { reserve: ReserveWithPhotos; siteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('id', reserve.id)
    formData.set('siteId', siteId)

    startTransition(async () => {
      const r = await liftReserveAction(formData)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success('Point levé')
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/40 transition-colors"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Lever le point
      </button>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2.5 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1">
        <label htmlFor={`lift-note-${reserve.id}`} className="text-xs text-muted-foreground">
          Note de levée (ce qui a été fait)
        </label>
        <input
          id={`lift-note-${reserve.id}`}
          name="liftNote"
          type="text"
          maxLength={280}
          disabled={pending}
          placeholder="ex. Fissure rebouchée et reprise peinture le 14/06"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={`lift-photo-${reserve.id}`} className="text-xs text-muted-foreground">
          Photo de preuve (après) — recommandée
        </label>
        <input
          id={`lift-photo-${reserve.id}`}
          name="photoAfter"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={pending}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]"
        >
          {pending ? 'Levée…' : 'Confirmer la levée'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Mini-dossier : action corrective + lien document (formulaires inline)
// ---------------------------------------------------------------------------

function CorrectiveActionForm({ reserveId, siteId }: { reserveId: string; siteId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('reserveId', reserveId)
    fd.set('siteId', siteId)
    start(async () => {
      const r = await addCorrectiveActionAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Action corrective ajoutée')
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Action corrective
      </button>
    )
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-center gap-1.5">
      <input name="title" required maxLength={200} placeholder="Action à réaliser"
        disabled={pending} className="flex-1 min-w-[160px] rounded border bg-background px-2 py-1 text-xs" />
      <input name="assignedTo" maxLength={120} placeholder="Responsable (option.)"
        disabled={pending} className="rounded border bg-background px-2 py-1 text-xs" />
      <button type="submit" disabled={pending}
        className="rounded bg-foreground text-background px-2 py-1 text-xs font-medium disabled:opacity-50">
        {pending ? '…' : 'Ajouter'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Annuler</button>
    </form>
  )
}

function LinkDocumentForm({ reserveId, siteId, siteDocuments, linkedIds }: {
  reserveId: string; siteId: string; siteDocuments: SiteDoc[]; linkedIds: Set<string>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const available = siteDocuments.filter((d) => !linkedIds.has(d.id))

  function link(documentId: string) {
    const fd = new FormData()
    fd.set('reserveId', reserveId); fd.set('siteId', siteId); fd.set('documentId', documentId)
    start(async () => {
      const r = await linkDocumentToReserveAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Document lié')
      setOpen(false)
      router.refresh()
    })
  }

  if (available.length === 0) return null
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <Link2 className="h-3 w-3" /> Lier un document
      </button>
    )
  }
  return (
    <select disabled={pending} defaultValue=""
      onChange={(e) => { if (e.target.value) link(e.target.value) }}
      className="rounded border bg-background px-2 py-1 text-xs max-w-[260px]">
      <option value="" disabled>Choisir un document du site…</option>
      {available.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Carte d'une réserve
// ---------------------------------------------------------------------------

function ReserveCard({ reserve, siteId, siteDocuments }: { reserve: ReserveWithPhotos; siteId: string; siteDocuments: SiteDoc[] }) {
  const isLifted = reserve.status === 'lifted'
  const linkedIds = new Set(reserve.documents.map((d) => d.id))
  const issuedOn = formatDate(reserve.issuedOn)
  const liftedAt = formatDate(reserve.liftedAt)

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2.5">
      {/* Ligne titre : libellé + statut */}
      <div className="flex items-start gap-2 flex-wrap">
        <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
        <span className="font-medium text-sm flex-1">{reserve.label}</span>
        {isLifted ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 shrink-0">
            Levé
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shrink-0">
            Ouvert
          </span>
        )}
      </div>

      {/* Chips info : zone, émetteur, date d'émission */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {reserve.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden />
            {reserve.location}
          </span>
        )}
        {reserve.issuedBy && (
          <span className="inline-flex items-center gap-1">
            <UserSquare className="h-3 w-3" aria-hidden />
            {reserve.issuedBy}
          </span>
        )}
        {issuedOn && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            Émise le {issuedOn}
          </span>
        )}
      </div>

      {/* Photos avant / après */}
      {(reserve.photoBeforeUrl || reserve.photoAfterUrl) && (
        <div className="flex flex-wrap gap-4">
          {reserve.photoBeforeUrl && <PhotoThumb url={reserve.photoBeforeUrl} label="Constat (avant)" />}
          {reserve.photoAfterUrl && <PhotoThumb url={reserve.photoAfterUrl} label="Preuve (après)" />}
        </div>
      )}

      {/* Actions correctives liées (mini-dossier) */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListTodo className="h-3 w-3" /> Actions correctives
        </div>
        {reserve.actions.length > 0 ? (
          <ul className="space-y-0.5">
            {reserve.actions.map((a) => (
              <li key={a.id} className="text-xs">
                • {a.title}
                {a.assignedTo && <span className="text-muted-foreground"> — {a.assignedTo}</span>}
                {a.dueDate && <span className="text-muted-foreground"> (éch. {a.dueDate})</span>}
                <span className="text-muted-foreground"> · {ACTION_STATUS_FR[a.status] ?? a.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground/70 italic">Aucune action corrective.</p>
        )}
        <CorrectiveActionForm reserveId={reserve.id} siteId={siteId} />
      </div>

      {/* Documents associés (clauses, fiches, PV…) */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-3 w-3" /> Documents associés
        </div>
        {reserve.documents.length > 0 ? (
          <ul className="space-y-0.5">
            {reserve.documents.map((d) => (
              <li key={d.id} className="text-xs">
                • <a href={`/documents/${d.id}`} className="hover:underline">{d.filename}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground/70 italic">Aucun document lié.</p>
        )}
        <LinkDocumentForm reserveId={reserve.id} siteId={siteId} siteDocuments={siteDocuments} linkedIds={linkedIds} />
      </div>

      {/* Détails de levée */}
      {isLifted && (
        <div className="space-y-1 border-l-2 border-emerald-200 pl-3">
          {liftedAt && (
            <p className="text-xs text-emerald-800 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Levé le {liftedAt}
            </p>
          )}
          {reserve.liftNote && (
            <p className="text-sm text-foreground/80 italic inline-flex items-start gap-1.5">
              <StickyNote className="h-3 w-3 shrink-0 mt-1 not-italic" aria-hidden />
              {reserve.liftNote}
            </p>
          )}
        </div>
      )}

      {/* Action de levée (réserves ouvertes uniquement) */}
      {!isLifted && (
        <div className="pt-1">
          <LiftForm reserve={reserve} siteId={siteId} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export principal — scindé Ouvertes / Levées
// ---------------------------------------------------------------------------

interface Props {
  siteId: string
  reserves: ReserveWithPhotos[]
  /** Documents du site, source du sélecteur « lier un document ». */
  siteDocuments: SiteDoc[]
}

export function ReservesView({ siteId, reserves, siteDocuments }: Props) {
  if (reserves.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        Aucun point à lever enregistré sur ce site pour le moment.
      </p>
    )
  }

  const open = reserves.filter((r) => r.status !== 'lifted')
  const lifted = reserves.filter((r) => r.status === 'lifted')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Ouverts</h2>
          <div className="flex-1 h-px bg-border/50" aria-hidden />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {open.length} point{open.length > 1 ? 's' : ''}
          </span>
        </div>
        {open.length === 0 ? (
          <p className="text-xs text-muted-foreground/80 italic">
            Aucun point ouvert — tout a été levé.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((r) => (
              <ReserveCard key={r.id} reserve={r} siteId={siteId} siteDocuments={siteDocuments} />
            ))}
          </div>
        )}
      </section>

      {lifted.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Levés</h2>
            <div className="flex-1 h-px bg-border/50" aria-hidden />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {lifted.length} point{lifted.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {lifted.map((r) => (
              <ReserveCard key={r.id} reserve={r} siteId={siteId} siteDocuments={siteDocuments} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
