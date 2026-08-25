'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Camera, CheckCircle2, ChevronDown, ClipboardCheck, FileText, History, Loader2, Mic, Video } from 'lucide-react'
import { importSiteEvidenceAction, uploadSiteDocumentAction } from './site-add-actions'
import { HistoricalPvUploadForm } from './HistoricalPvUploadForm'
import { createQuickActionAction } from '@/app/(dashboard)/actions/actions'
import { createReserveAction } from './reserves/actions'

type DialogKind = 'document' | 'evidence' | 'historical_pv' | 'action' | 'reserve' | null

export function SiteAddMenu({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [message, setMessage] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function openDialog(kind: DialogKind) {
    setMessage(null)
    setDialog(kind)
    setOpen(false)
  }

  // ── LE MENU S'OUVRE AU CLIC, PLUS AU SURVOL (G1, Guillaume 2026-07-21) ────
  //
  // Il s'ouvrait sur `onMouseEnter` et se fermait sur le `onMouseLeave` du
  // conteneur. Or le panneau est décollé du bouton de 8 px (`mt-2`) : en
  // descendant vers une entrée, la souris traversait ce vide — qui n'appartient
  // à aucun descendant — et le menu se refermait avant d'être atteint. Sur
  // desktop, il était donc INUTILISABLE : il s'ouvrait, et rien n'était
  // cliquable. Le bouton n'avait d'ailleurs aucun `onClick` : le menu
  // n'existait qu'au survol, donc pas du tout au clavier ni au toucher.
  //
  // Un menu se pilote au clic. Il se ferme sur clic extérieur et sur Échap.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Ajouter <ChevronDown className="h-4 w-4" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-72 rounded-xl border bg-popover p-2 shadow-lg">
          <MenuButton icon={<FileText className="h-4 w-4" />} label="Document PDF" onClick={() => openDialog('document')} />
          <MenuButton icon={<Camera className="h-4 w-4" />} label="Photos, vidéos, vocaux" onClick={() => openDialog('evidence')} />
          <MenuButton icon={<History className="h-4 w-4" />} label="PV historique — analyser" onClick={() => openDialog('historical_pv')} />
          <MenuButton icon={<CheckCircle2 className="h-4 w-4" />} label="Créer une action" onClick={() => openDialog('action')} />
          <MenuButton icon={<ClipboardCheck className="h-4 w-4" />} label="Créer une réserve" onClick={() => openDialog('reserve')} />
        </div>
      )}

      {dialog === 'document' && (
        <SiteDocumentDialog
          siteId={siteId}
          message={message}
          setMessage={setMessage}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'evidence' && (
        <SiteEvidenceDialog
          siteId={siteId}
          message={message}
          setMessage={setMessage}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'historical_pv' && (
        <SiteHistoricalPvDialog
          siteId={siteId}
          message={message}
          setMessage={setMessage}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'action' && (
        <SiteCreateActionDialog
          siteId={siteId}
          message={message}
          setMessage={setMessage}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reserve' && (
        <SiteCreateReserveDialog
          siteId={siteId}
          message={message}
          setMessage={setMessage}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted">
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function SiteDocumentDialog({
  siteId,
  message,
  setMessage,
  onClose,
}: {
  siteId: string
  message: string | null
  setMessage: (message: string | null) => void
  onClose: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    startTransition(async () => {
      try {
        const result = await uploadSiteDocumentAction(siteId, fd)
        if (!result.ok) {
          setMessage(result.error ?? 'Import impossible.')
          return
        }
        setMessage(result.duplicate ? 'Document déjà connu, lien ajouté au chantier.' : 'Document ajouté au chantier.')
        form.reset()
      } catch (e) {
        console.error('[SiteDocumentDialog]', e)
        setMessage('Erreur réseau — veuillez réessayer.')
      }
    })
  }

  return (
    <Modal title="Ajouter un document au chantier" onClose={onClose}>
      <form ref={formRef} className="space-y-4" onSubmit={submit}>
        <input type="hidden" name="document_type" value="preuve" />
        <input type="hidden" name="visibility_level" value="manager" />
        <input type="hidden" name="embed" value="true" />
        <input type="hidden" name="memory_tier" value="consultable" />
        <label className="block space-y-2">
          <span className="text-sm font-medium">PDF</span>
          <input name="file" type="file" accept="application/pdf" required className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        {message && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Fermer</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ajouter
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SiteEvidenceDialog({
  siteId,
  message,
  setMessage,
  onClose,
}: {
  siteId: string
  message: string | null
  setMessage: (message: string | null) => void
  onClose: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    startTransition(async () => {
      try {
        const result = await importSiteEvidenceAction(siteId, fd)
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        setMessage(`${result.created} élément(s) ajouté(s) au chantier.`)
        form.reset()
      } catch (e) {
        console.error('[SiteEvidenceDialog]', e)
        setMessage('Erreur réseau — veuillez réessayer.')
      }
    })
  }

  return (
    <Modal title="Ajouter des preuves au chantier" onClose={onClose}>
      <form ref={formRef} className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Photos, vidéos, vocaux ou PDF</span>
          <input name="files" type="file" accept="image/*,video/*,audio/*,application/pdf" multiple required className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span className="inline-flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Photos</span>
          <span className="inline-flex items-center gap-1.5"><Video className="h-3.5 w-3.5" /> Vidéos</span>
          <span className="inline-flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" /> Vocaux</span>
        </div>
        {message && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Fermer</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ajouter
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SiteHistoricalPvDialog({
  siteId,
  message,
  setMessage,
  onClose,
}: {
  siteId: string
  message: string | null
  setMessage: (message: string | null) => void
  onClose: () => void
}) {
  return (
    <Modal title="Importer un PV historique" onClose={onClose}>
      <HistoricalPvUploadForm siteId={siteId} onClose={onClose} />
    </Modal>
  )
}

function SiteCreateActionDialog({
  siteId,
  message,
  setMessage,
  onClose,
}: {
  siteId: string
  message: string | null
  setMessage: (message: string | null) => void
  onClose: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    fd.set('site_id', siteId)
    fd.set('created_from', 'desktop_site')
    startTransition(async () => {
      try {
        const result = await createQuickActionAction(fd)
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        setMessage('Action créée.')
        form.reset()
      } catch (e) {
        console.error('[SiteCreateActionDialog]', e)
        setMessage('Erreur réseau — veuillez réessayer.')
      }
    })
  }

  return (
    <Modal title="Créer une action" onClose={onClose}>
      <form ref={formRef} className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Titre</span>
          <input name="title" type="text" required maxLength={200} placeholder="Ex : Reprendre la réservation plomberie cuisine" className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Échéance <span className="text-muted-foreground font-normal">(optionnelle)</span></span>
          <input name="due_date" type="date" className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        {message && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Fermer</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SiteCreateReserveDialog({
  siteId,
  message,
  setMessage,
  onClose,
}: {
  siteId: string
  message: string | null
  setMessage: (message: string | null) => void
  onClose: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    fd.set('siteId', siteId)
    startTransition(async () => {
      try {
        const result = await createReserveAction(fd)
        if ('error' in result) {
          setMessage(result.error)
          return
        }
        setMessage('Réserve créée.')
        form.reset()
      } catch (e) {
        console.error('[SiteCreateReserveDialog]', e)
        setMessage('Erreur réseau — veuillez réessayer.')
      }
    })
  }

  return (
    <Modal title="Créer une réserve" onClose={onClose}>
      <form ref={formRef} className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Libellé</span>
          <input name="label" type="text" required maxLength={280} placeholder="Ex : Largeur non conforme" className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Localisation <span className="text-muted-foreground font-normal">(optionnelle)</span></span>
          <input name="location" type="text" maxLength={140} className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Signalée par <span className="text-muted-foreground font-normal">(optionnel)</span></span>
          <input name="issuedBy" type="text" maxLength={140} className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Date <span className="text-muted-foreground font-normal">(optionnelle)</span></span>
          <input name="issuedOn" type="date" className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Photo de constat <span className="text-muted-foreground font-normal">(optionnelle)</span></span>
          <input name="photoBefore" type="file" accept="image/*" className="block w-full rounded-lg border p-2 text-sm" />
        </label>
        {message && <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Fermer</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">La page chantier reste ouverte.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border px-2 py-1 text-sm hover:bg-muted">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
