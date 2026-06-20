'use client'

// Grille de photos du CR (priorité #1 Vincent). Par photo : vignette, légende
// ÉDITABLE (corrige la mémoire), ⭐ couverture, ↑↓ ordre, exclure. + un commentaire
// GÉNÉRAL du bloc photos. Présentation propre au CR (mig 129) ; ne touche pas la photo.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, EyeOff, RotateCcw, Loader2, ImageOff, Star, ArrowUp, ArrowDown, Trash2, ImagePlus } from 'lucide-react'
import {
  setPhotoCaptionAction, excludePvItemAction, includePvItemAction,
  setCoverPhotoAction, reorderPhotosAction, setPhotosCommentAction,
  addReportPhotoAction, deleteReportPhotoAction,
} from '../../pv-actions'

export interface PhotoCard {
  id: string
  source: 'intervention' | 'action' | 'report'
  thumbUrl: string | null
  legende: string
  excluded: boolean
  isCover: boolean
}

type ActionRes = { ok: true } | { ok: false; error: string }

function PhotoTile({
  reportId, photo, index, total, onMove,
}: { reportId: string; photo: PhotoCard; index: number; total: number; onMove: (i: number, dir: 'up' | 'down') => void }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(photo.legende)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<ActionRes>, onOk?: () => void) {
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
          <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageOff className="h-6 w-6" /></div>
        )}
        {/* Couverture (⭐) en surimpression */}
        <button
          type="button"
          disabled={pending}
          title={photo.isCover ? 'Photo de couverture' : 'Définir comme couverture'}
          onClick={() => run(() => setCoverPhotoAction(reportId, photo.id, photo.source, !photo.isCover))}
          className={`absolute right-1 top-1 rounded-full p-1 ${photo.isCover ? 'bg-amber-400 text-white' : 'bg-black/40 text-white hover:bg-black/60'}`}
        >
          <Star className={`h-3.5 w-3.5 ${photo.isCover ? 'fill-current' : ''}`} />
        </button>
        {photo.excluded && <span className="absolute left-1 top-1 rounded-full bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-white">exclue</span>}
      </div>

      <div className="space-y-1 p-1.5">
        {editing ? (
          <div className="space-y-1">
            <textarea autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} rows={2}
              className="w-full rounded-md border bg-background px-1.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <div className="flex items-center gap-1.5">
              <button type="button" disabled={pending} onClick={() => run(() => setPhotoCaptionAction(reportId, photo.id, photo.source, caption), () => setEditing(false))}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} OK
              </button>
              <button type="button" disabled={pending} onClick={() => { setCaption(photo.legende); setEditing(false); setError(null) }} className="text-[10px] text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          <p className={`line-clamp-2 text-[11px] ${photo.legende ? '' : 'italic text-muted-foreground'}`}>{photo.legende || 'Sans légende'}</p>
        )}

        {!editing && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <button type="button" disabled={pending} title="Modifier la légende" onClick={() => setEditing(true)} className="hover:text-foreground disabled:opacity-50"><Pencil className="h-3 w-3" /></button>
            <button type="button" disabled={pending || index === 0} title="Monter" onClick={() => onMove(index, 'up')} className="hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button type="button" disabled={pending || index === total - 1} title="Descendre" onClick={() => onMove(index, 'down')} className="hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            {/* Photo report = ajout éditorial → VRAIE suppression. Photo terrain
                (intervention/action) = artefact → « exclure » réversible seulement. */}
            {photo.source === 'report' ? (
              <button type="button" disabled={pending} title="Supprimer la photo"
                onClick={() => { if (confirm('Supprimer définitivement cette photo ajoutée ?')) run(() => deleteReportPhotoAction(reportId, photo.id)) }}
                className="hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-3 w-3" /></button>
            ) : photo.excluded ? (
              <button type="button" disabled={pending} title="Réintégrer" onClick={() => run(() => includePvItemAction(reportId, photo.id))} className="hover:text-foreground disabled:opacity-50"><RotateCcw className="h-3 w-3" /></button>
            ) : (
              <button type="button" disabled={pending} title="Exclure du PV" onClick={() => run(() => excludePvItemAction(reportId, photo.id))} className="hover:text-rose-600 disabled:opacity-50"><EyeOff className="h-3 w-3" /></button>
            )}
          </div>
        )}
        {error && <p className="text-[10px] text-rose-600">{error}</p>}
      </div>
    </li>
  )
}

function GeneralComment({ reportId, comment }: { reportId: string; comment: string }) {
  const router = useRouter()
  const [value, setValue] = useState(comment)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = value.trim() !== comment.trim()

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await setPhotosCommentAction(reportId, value)
        if (res.ok) router.refresh()
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder="Commentaire général des photos (ex. « avancement conforme malgré un léger retard zone nord »)"
        className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer le commentaire
        </button>
        {error && <span className="text-[11px] text-rose-600">{error}</span>}
      </div>
    </div>
  )
}

function AddPhoto({ reportId }: { reportId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    startTransition(async () => {
      try {
        // Upload séquentiel (plusieurs photos d'un coup) — simple et fiable.
        for (const file of Array.from(files)) {
          const fd = new FormData()
          fd.set('report_id', reportId)
          fd.set('file', file)
          if (caption.trim()) fd.set('caption', caption)
          const res = await addReportPhotoAction(fd)
          if (!res.ok) { setError(res.error); break }
        }
        setCaption('')
        if (inputRef.current) inputRef.current.value = ''
        router.refresh()
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Légende (optionnelle) de la prochaine photo"
          className="min-w-[12rem] flex-1 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <button type="button" disabled={pending} onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Ajouter une photo
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPick(e.target.files)} />
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

export function PvPhotoGrid({ reportId, photos, comment }: { reportId: string; photos: PhotoCard[]; comment: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onMove(index: number, dir: 'up' | 'down') {
    const j = dir === 'up' ? index - 1 : index + 1
    if (j < 0 || j >= photos.length) return
    const moved = [...photos]
    ;[moved[index], moved[j]] = [moved[j], moved[index]]
    startTransition(async () => {
      try {
        const res = await reorderPhotosAction(reportId, moved.map((p) => ({ id: p.id, source: p.source })))
        if (res.ok) router.refresh()
      } catch { /* l'erreur de réordonnancement n'est pas bloquante */ }
    })
  }

  return (
    <div className="space-y-2">
      <GeneralComment reportId={reportId} comment={comment} />
      <AddPhoto reportId={reportId} />
      {photos.length > 0 ? (
        <ul className={`grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 ${pending ? 'opacity-60' : ''}`}>
          {photos.map((p, i) => (
            <PhotoTile key={p.id} reportId={reportId} photo={p} index={i} total={photos.length} onMove={onMove} />
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-muted-foreground">Aucune photo — ajoutez-en une ci-dessus.</p>
      )}
    </div>
  )
}
