'use client'

// Le DOSSIER, pièce par pièce.
//
// « Un appel d'offres n'est jamais un document » (Guillaume, session terrain).
// Cette carte est la seule à dire la vérité sur ce que MemorIA a réellement lu :
// quelles pièces sont là, laquelle n'a pas pu être lue, et si l'analyse affichée
// est plus vieille que le dossier. Une analyse qui n'a pas vu le CCTP mais ne le
// dit pas est pire qu'une absence d'analyse : elle est confiante.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Plus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { tenderPieceLabel } from '@/lib/tenders/pieces'
import type { TenderPieceKind } from '@/types/db'
import { addTenderPiecesAction } from './actions'

export interface TenderPieceView {
  id: string
  filename: string
  kind: TenderPieceKind | null
  sizeBytes: number | null
  /** Le texte a-t-il été extrait ? Une pièce non lue ne nourrit AUCUNE analyse. */
  read: boolean
  uploadedAt: string
}

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function TenderPiecesCard({
  tenderId,
  pieces,
  analysedAt,
  canEdit,
}: {
  tenderId: string
  pieces: TenderPieceView[]
  /** Date de l'analyse affichée — sert à dire si le dossier a bougé depuis. */
  analysedAt: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [uploading, setUploading] = useState(false)

  // Pièces déposées APRÈS l'analyse : elles n'ont pas été lues par elle.
  const uncovered = analysedAt ? pieces.filter((p) => p.uploadedAt > analysedAt) : []
  const unread = pieces.filter((p) => !p.read)

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    const fd = new FormData()
    fd.set('id', tenderId)
    for (const f of files) fd.append('file', f)
    setUploading(true)
    start(async () => {
      const r = await addTenderPiecesAction(fd)
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
      if ('error' in r && r.error) {
        toast.error(r.error)
        return
      }
      toast.success(r.added && r.added > 1 ? `${r.added} pièces ajoutées.` : 'Pièce ajoutée.')
      router.refresh()
    })
  }

  const busy = pending || uploading

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          Pièces du dossier{pieces.length > 0 && <span className="ml-1.5 text-muted-foreground">({pieces.length})</span>}
        </CardTitle>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(e) => onPick(e.target.files)}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Ajouter des pièces
            </Button>
          </>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {pieces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune pièce déposée. Un dossier se lit au complet : règlement de consultation,
            CCAP, CCTP, décomposition du prix, bordereau des prix, plans.
          </p>
        ) : (
          <ul className="divide-y">
            {pieces.map((piece) => (
              <li key={piece.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tenderPieceLabel(piece.kind)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {piece.filename}
                    {formatSize(piece.sizeBytes) && ` · ${formatSize(piece.sizeBytes)}`}
                  </p>
                </div>
                {!piece.read && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                    Non lue
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* On ne masque jamais une pièce illisible : elle ne nourrit aucune analyse. */}
        {unread.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {unread.length === 1 ? 'Une pièce n’a pas pu être lue' : `${unread.length} pièces n’ont pas pu être lues`}
              {' '}(PDF scanné ?). Son contenu n&apos;entre pas dans l&apos;analyse.
            </span>
          </p>
        )}

        {uncovered.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              L&apos;analyse affichée est antérieure à{' '}
              {uncovered.length === 1 ? 'une pièce ajoutée depuis' : `${uncovered.length} pièces ajoutées depuis`}.
              Relancez l&apos;analyse pour qu&apos;elle en tienne compte.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
