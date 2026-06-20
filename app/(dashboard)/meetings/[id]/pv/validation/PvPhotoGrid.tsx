'use client'

// Grille de photos du CR (priorité #1 Vincent : sur un CR chantier les photos
// valent souvent plus que le texte). Vignette + légende ÉDITABLE + Exclure/Réintégrer.
// Modifier la légende corrige la MÉMOIRE (la photo enrichie ressert partout).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, EyeOff, RotateCcw, Loader2, ImageOff } from 'lucide-react'
import { setPhotoCaptionAction, excludePvItemAction, includePvItemAction } from '../../pv-actions'

export interface PhotoCard {
  id: string
  source: 'intervention' | 'action'
  thumbUrl: string | null
  legende: string
  excluded: boolean
}

function PhotoTile({ reportId, photo }: { reportId: string; photo: PhotoCard }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(photo.legende)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res.ok) { onOk?.(); router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <li className={`overflow-hidden rounded-lg border bg-card ${photo.excluded ? 'opacity-60' : ''}`}>
      <div className="relative aspect-[4/3] bg-muted/40">
        {photo.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumbUrl} alt={photo.legende || 'photo chantier'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        {photo.excluded && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-white">exclue</span>
        )}
      </div>

      <div className="space-y-1.5 p-2">
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              autoFocus
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <div className="flex items-center gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => setPhotoCaptionAction(reportId, photo.id, photo.source, caption), () => setEditing(false))}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Enregistrer
              </button>
              <button type="button" disabled={pending} onClick={() => { setCaption(photo.legende); setEditing(false); setError(null) }}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" /> Annuler
              </button>
            </div>
          </div>
        ) : (
          <p className={`text-xs ${photo.legende ? '' : 'italic text-muted-foreground'}`}>{photo.legende || 'Sans légende'}</p>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <button type="button" disabled={pending} onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
              <Pencil className="h-3 w-3" /> Légende
            </button>
            {photo.excluded ? (
              <button type="button" disabled={pending} onClick={() => run(() => includePvItemAction(reportId, photo.id))} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> Réintégrer
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => run(() => excludePvItemAction(reportId, photo.id))} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                <EyeOff className="h-3 w-3" /> Exclure
              </button>
            )}
          </div>
        )}
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </div>
    </li>
  )
}

export function PvPhotoGrid({ reportId, photos }: { reportId: string; photos: PhotoCard[] }) {
  if (photos.length === 0) return null
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {photos.map((p) => <PhotoTile key={p.id} reportId={reportId} photo={p} />)}
    </ul>
  )
}
