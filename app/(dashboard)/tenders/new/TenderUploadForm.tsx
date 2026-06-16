'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createTenderAction } from './actions'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'

export function TenderUploadForm() {
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    const fd = new FormData(e.currentTarget)
    const r = await createTenderAction(fd)
    setPending(false)
    if (r && 'error' in r) toast.error(r.error)
    // success → redirect happens server-side
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nouveau dossier de démarrage</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titre du dossier</Label>
            <Input id="title" name="title" required maxLength={200} placeholder="Ex. Marché d'entretien et de travaux 2026" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client_name">Donneur d&apos;ordre (optionnel)</Label>
            <Input id="client_name" name="client_name" maxLength={200} placeholder="Ex. Mairie, hôpital, promoteur…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline">Échéance (optionnel)</Label>
            <Input id="deadline" name="deadline" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">PDF du cahier des charges (max 20 MB, non scanné)</Label>
            <Input id="file" name="file" type="file" accept="application/pdf" required />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {pending ? 'Upload + analyse en cours…' : 'Lancer l\'analyse IA'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
