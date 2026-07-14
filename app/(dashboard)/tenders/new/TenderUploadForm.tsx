'use client'

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createTenderAction } from './actions'
import { toast } from 'sonner'
import { Upload, FileText, X } from 'lucide-react'
import { detectPieceKind, tenderPieceLabel } from '@/lib/tenders/pieces'

const MAX_PIECES = 12

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function TenderUploadForm({ dossierId }: { dossierId?: string }) {
  const [pending, setPending] = useState(false)
  // Un appel d'offres est un DOSSIER : RC, CCAP, CCTP, DPGF, BPU, plans. On en
  // accepte plusieurs — une seule pièce reste un dépôt valide.
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Compteur de temps pendant l'envoi (alimente la barre de progression).
  useEffect(() => {
    if (!pending) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [pending])

  /** L'input réel porte les fichiers dans le FormData : on le tient synchronisé. */
  function syncInput(next: File[]) {
    if (!inputRef.current) return
    const dt = new DataTransfer()
    next.forEach((f) => dt.items.add(f))
    inputRef.current.files = dt.files
  }

  function addFiles(incoming: File[]) {
    const accepted: File[] = []
    for (const f of incoming) {
      if (f.type !== 'application/pdf') {
        toast.error(`${f.name} n'est pas un PDF.`)
        continue
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name} dépasse 20 Mo.`)
        continue
      }
      accepted.push(f)
    }
    if (accepted.length === 0) return

    setFiles((prev) => {
      // Même nom + même taille = même pièce redéposée : on ne la double pas.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of accepted) {
        if (seen.has(`${f.name}:${f.size}`)) continue
        merged.push(f)
      }
      const capped = merged.slice(0, MAX_PIECES)
      if (merged.length > MAX_PIECES) toast.error(`Maximum ${MAX_PIECES} pièces.`)
      syncInput(capped)
      return capped
    })
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      syncInput(next)
      return next
    })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    addFiles([...(e.dataTransfer.files ?? [])])
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (files.length === 0) {
      toast.error('Ajoutez au moins une pièce du dossier.')
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
          {/* AO créé DEPUIS une affaire → rattachement auto (pas de manip). */}
          {dossierId && <input type="hidden" name="dossier_id" value={dossierId} />}
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

          {/* Zone de dépôt — l'action attendue est explicite. */}
          <div className="space-y-2">
            <Label htmlFor="file">Pièces du dossier</Label>

            {/* input réel masqué : c'est lui qui porte les fichiers dans le FormData */}
            <input
              ref={inputRef}
              id="file"
              name="file"
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(e) => addFiles([...(e.target.files ?? [])])}
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/30 bg-muted/30 hover:border-primary/60 hover:bg-muted/50'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium">
                {files.length === 0
                  ? <>Glissez les pièces ici, ou <span className="text-primary underline">cliquez pour les choisir</span></>
                  : <>Ajouter d&apos;autres pièces</>}
              </p>
              <p className="text-xs text-muted-foreground">
                Règlement de consultation, CCAP, CCTP, DPGF, BPU, plans, annexes — PDF, 20 Mo par pièce
              </p>
            </div>

            {files.length > 0 && (
              <ul className="space-y-2 pt-1">
                {files.map((file, index) => {
                  const kind = detectPieceKind(file.name)
                  return (
                    <li
                      key={`${file.name}:${file.size}`}
                      className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {/* La nature est PROPOSÉE, jamais affirmée : une pièce non
                              reconnue est lue quand même, elle est seulement mal nommée. */}
                          {tenderPieceLabel(kind)} · {formatSize(file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Retirer ${file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {pending ? 'Envoi du dossier en cours…' : 'Lancer l\'analyse IA'}
          </Button>

          {pending && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                  // Envoi des pièces (~10 s typiques) : progresse vers ~90 % puis
                  // la page redirige vers le dossier où l'analyse continue.
                  style={{ width: `${Math.min(90, Math.round((1 - Math.exp(-elapsed / 6)) * 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground text-center">
                Envoi des pièces puis redirection vers le dossier — l&apos;analyse s&apos;y poursuit.
              </p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
