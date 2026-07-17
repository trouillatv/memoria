'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createSiteAction } from '../sites-actions'
import {
  SiteExtendedFields,
  emptySiteExtendedState,
  applySiteExtendedToFormData,
} from '@/app/(dashboard)/sites/SiteExtendedFields'

export function CreateSiteForm({ contractId, clientName: _clientName }: { contractId: string; clientName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [extended, setExtended] = useState(emptySiteExtendedState())

  function reset() {
    setName(''); setAddress(''); setNotes('')
    setExtended(emptySiteExtendedState())
  }

  async function submit() {
    if (!name.trim()) {
      toast.error('Nom requis')
      return
    }
    const fd = new FormData()
    fd.set('contract_id', contractId)
    fd.set('client_id', '00000000-0000-0000-0000-000000000000') // placeholder, server resolves
    fd.set('name', name.trim())
    if (address.trim()) fd.set('address', address.trim())
    if (notes.trim()) fd.set('notes', notes.trim())
    applySiteExtendedToFormData(fd, extended)

    startTransition(async () => {
      const r = await createSiteAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Chantier ajouté')
        reset()
        setOpen(false)
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter un chantier
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nouveau chantier</h3>
        <button type="button" onClick={() => { setOpen(false); reset() }} className="p-1 rounded hover:bg-muted/50" aria-label="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Nom du chantier *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border p-2 text-sm" maxLength={200} disabled={pending} />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Adresse</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded border p-2 text-sm" maxLength={500} disabled={pending} />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Notes (optionnel)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded border p-2 text-sm" rows={2} maxLength={2000} disabled={pending} />
      </div>
      <SiteExtendedFields
        state={extended}
        onChange={(patch) => setExtended((s) => ({ ...s, ...patch }))}
        disabled={pending}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setOpen(false); reset() }} disabled={pending} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || !name.trim()} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50">
          {pending ? 'Ajout...' : 'Ajouter'}
        </button>
      </div>
    </div>
  )
}
