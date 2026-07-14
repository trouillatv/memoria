'use client'

// LE PENDANT OBLIGATOIRE DU « SANS CLIENT ».
//
// Une prévisite devient une affaire, un repérage devient un contrat. Sans ce
// geste, « sans client » serait une impasse — et l'utilisateur inventerait un
// client fictif pour en sortir, ce que la migration 210 vient précisément de
// rendre inutile.
//
// Le client est choisi ou créé EXPLICITEMENT. Jamais deviné à partir du nom du
// chantier : trois « Discount » en base coûteraient plus cher que le clic
// qu'on économiserait.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { attachClientToSiteAction } from '../actions'

export function AttachClientButton({
  siteId,
  clients,
}: {
  siteId: string
  clients: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const r = await attachClientToSiteAction({
        site_id: siteId,
        ...(creating ? { client_name_new: newName.trim() } : { client_id: clientId }),
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(`Chantier rattaché à ${r.clientName}.`)
      setOpen(false)
      router.refresh()
    })
  }

  const canSubmit = creating ? newName.trim().length > 0 : clientId.length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Building2 className="h-3.5 w-3.5" />
            Associer un client
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Associer un client</DialogTitle>
          <DialogDescription>
            Ce chantier n&apos;a pas encore de client. Choisissez-en un, ou créez-le —
            rien n&apos;est deviné à partir du nom du chantier.
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <div className="space-y-2">
            <Label htmlFor="new-client">Nom du nouveau client</Label>
            <input
              id="new-client"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={200}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="ex. DISCOUNT"
              autoFocus
            />
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName('') }}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Choisir un client existant
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <select
              id="client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Choisir un client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setCreating(true); setClientId('') }}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              + Nouveau client
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending || !canSubmit}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Associer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
