'use client'

// Ligne d'un site sur la page Contrat > Sites.
// Mode lecture : nom + adresse + notes + dernières site_notes (mémoire des lieux) + actions.
// Mode édition : formulaire inline name/address/notes, sauvegarde via server action.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pencil, X, MessageSquare } from 'lucide-react'
import { SiteFieldsDisplay } from '@/app/(dashboard)/sites/SiteFieldsDisplay'
import { toast } from 'sonner'
import type { DbSite, DbSiteNote } from '@/types/db'
import { updateSiteAction } from '../sites-actions'
import {
  SiteExtendedFields,
  siteExtendedFromDb,
  applySiteExtendedToFormData,
  hasAnyExtendedField,
} from '@/app/(dashboard)/sites/SiteExtendedFields'

interface Props {
  contractId: string
  site: DbSite
  notes: DbSiteNote[]
}

export function SiteRow({ contractId, site, notes }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(site.name)
  const [address, setAddress] = useState(site.address ?? '')
  const [notesField, setNotesField] = useState(site.notes ?? '')
  const [extended, setExtended] = useState(siteExtendedFromDb(site))

  function cancel() {
    setName(site.name)
    setAddress(site.address ?? '')
    setNotesField(site.notes ?? '')
    setExtended(siteExtendedFromDb(site))
    setEditing(false)
  }

  async function submit() {
    if (!name.trim()) {
      toast.error('Nom requis')
      return
    }
    const fd = new FormData()
    fd.set('contract_id', contractId)
    fd.set('site_id', site.id)
    fd.set('name', name.trim())
    if (address.trim()) fd.set('address', address.trim())
    if (notesField.trim()) fd.set('notes', notesField.trim())
    applySiteExtendedToFormData(fd, extended)

    startTransition(async () => {
      const r = await updateSiteAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Site mis à jour')
        setEditing(false)
        router.refresh()
      }
    })
  }

  if (editing) {
    return (
      <li className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Éditer le chantier</h3>
          <button
            type="button"
            onClick={cancel}
            className="p-1 rounded hover:bg-muted/50"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Nom du chantier *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            maxLength={200}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Adresse</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            maxLength={500}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Notes (optionnel)</label>
          <textarea
            value={notesField}
            onChange={(e) => setNotesField(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            rows={2}
            maxLength={2000}
            disabled={pending}
          />
        </div>
        <SiteExtendedFields
          state={extended}
          onChange={(patch) => setExtended((s) => ({ ...s, ...patch }))}
          disabled={pending}
          initiallyOpen={hasAnyExtendedField(extended)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {pending ? 'Sauvegarde...' : 'Enregistrer'}
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{site.name}</div>
          {site.address && (
            <div className="text-xs text-muted-foreground">{site.address}</div>
          )}
          {site.notes && (
            <div className="text-xs text-muted-foreground italic mt-1 whitespace-pre-wrap">
              {site.notes}
            </div>
          )}
          <div className="mt-2">
            <SiteFieldsDisplay site={site} />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Éditer le chantier"
          >
            <Pencil className="h-3.5 w-3.5" />
            Éditer
          </button>
          <Link
            href={`/contracts/${contractId}/missions?site=${site.id}`}
            className="text-xs hover:underline whitespace-nowrap"
          >
            Voir missions →
          </Link>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="border-t pt-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" aria-hidden />
            Mémoire des lieux ({notes.length})
          </div>
          <ul className="space-y-1">
            {notes.map((n) => (
              <li key={n.id} className="text-xs text-foreground/80 flex items-baseline gap-2">
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {formatNoteDate(n.created_at)}
                </span>
                <span className="whitespace-pre-wrap">{n.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}
