'use client'

import { useState, useTransition } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createMissionAction } from './actions'

const CADENCES = [
  { value: 'daily',     label: 'Quotidienne' },
  { value: 'weekly',    label: 'Hebdomadaire' },
  { value: 'biweekly',  label: 'Bihebdomadaire' },
  { value: 'monthly',   label: 'Mensuelle' },
  { value: 'on_demand', label: 'À la demande' },
] as const

interface Props {
  sites: Array<{ id: string; name: string; contractName: string | null }>
}

export function NewMissionDialog({ sites }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await createMissionAction(formData)
      if ('error' in result) {
        setError(result.error)
      } else {
        setOpen(false)
        form.reset()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null) }}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5" />
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Nouvelle mission
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle mission</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Site *</label>
            <select
              name="site_id"
              required
              defaultValue=""
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="" disabled>Sélectionner un site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.contractName ? ` — ${s.contractName}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nom de la mission *</label>
            <input
              name="name"
              type="text"
              required
              maxLength={200}
              placeholder="ex : Nettoyage quotidien halls"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Cadence *</label>
            <select
              name="cadence"
              required
              defaultValue="weekly"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" size="sm" />}
            >
              Annuler
            </DialogClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
