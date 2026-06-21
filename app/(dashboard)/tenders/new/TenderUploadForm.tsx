'use client'

import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createTenderAction } from './actions'
import { toast } from 'sonner'
import { Upload, FileText, X } from 'lucide-react'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function TenderUploadForm() {
  const [pending, setPending] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | null) {
    if (f && f.type !== 'application/pdf') {
      toast.error('Le fichier doit être un PDF.')
      return
    }
    if (f && f.size > 20 * 1024 * 1024) {
      toast.error('Le PDF dépasse 20 Mo.')
      return
    }
    setFile(f)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0] ?? null
    pickFile(f)
    // Reflète le fichier déposé dans l'input réel (pour l'envoi du formulaire).
    if (f && inputRef.current) {
      const dt = new DataTransfer()
      dt.items.add(f)
      inputRef.current.files = dt.files
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) {
      toast.error('Choisissez d\'abord le PDF du cahier des charges.')
      return
    }
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

          {/* Zone d'upload encadrée — l'action attendue est explicite. */}
          <div className="space-y-2">
            <Label htmlFor="file">PDF du cahier des charges</Label>

            {/* input réel masqué : c'est lui qui porte le fichier dans le FormData */}
            <input
              ref={inputRef}
              id="file"
              name="file"
              type="file"
              accept="application/pdf"
              required
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />

            {!file ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/30 bg-muted/30 hover:border-primary/60 hover:bg-muted/50'
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <p className="text-sm font-medium">
                  Glissez le PDF ici, ou <span className="text-primary underline">cliquez pour le choisir</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Cahier des charges au format PDF (max 20 Mo, non scanné)
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)} · PDF</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Retirer le fichier"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
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
