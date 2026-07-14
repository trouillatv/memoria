'use client'

import { useRef, useState, useTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import { Camera, ChevronDown, FileText, Loader2, Mic, Video } from 'lucide-react'
import { importSiteEvidenceAction, uploadSiteDocumentAction } from './site-add-actions'

type DialogKind = 'document' | 'evidence' | null

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

  return (
    <div
      ref={menuRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!menuRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Ajouter <ChevronDown className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border bg-popover p-2 shadow-lg">
          <MenuButton icon={<FileText className="h-4 w-4" />} label="Document PDF" onClick={() => openDialog('document')} />
          <MenuButton icon={<Camera className="h-4 w-4" />} label="Photos, vidéos, vocaux" onClick={() => openDialog('evidence')} />
          <Link href={`/sites/${siteId}/actions`} className="block rounded-lg px-2.5 py-2 text-sm hover:bg-muted">
            Créer une action
          </Link>
          <Link href={`/sites/${siteId}/reserves`} className="block rounded-lg px-2.5 py-2 text-sm hover:bg-muted">
            Créer une réserve
          </Link>
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
      const result = await uploadSiteDocumentAction(siteId, fd)
      if (!result.ok) {
        setMessage(result.error ?? 'Import impossible.')
        return
      }
      setMessage(result.duplicate ? 'Document déjà connu, lien ajouté au chantier.' : 'Document ajouté au chantier.')
      form.reset()
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
      const result = await importSiteEvidenceAction(siteId, fd)
      if (!result.ok) {
        setMessage(result.error)
        return
      }
      setMessage(`${result.created} élément(s) ajouté(s) au chantier.`)
      form.reset()
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
