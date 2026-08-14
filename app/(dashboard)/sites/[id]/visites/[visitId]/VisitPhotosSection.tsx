'use client'

// ── PHOTOS DE LA VISITE — la continuité terrain → bureau ─────────────────────
//
// Guillaume capture les preuves sur mobile ; au moment de CONTINUER la visite
// et finaliser le CR sur ordinateur, il doit les retrouver, les parcourir en
// grand, corriger une légende, et annoter avec le MÊME outil que le terrain.
//
// Aucune deuxième logique photo : les données viennent de visit_capture
// (listVisitCaptures côté serveur, mêmes règles que mobile — hidden_at masqué),
// l'annotation est le PhotoAnnotator mobile monté tel quel (Pointer Events →
// souris native), la sauvegarde passe par le MÊME chemin serveur que le
// terrain (upload pièce + addPhotoCaptureAction : nouvelle capture aplatie,
// annotated_original_id, starred → entre au CR/PDF par la règle existante).
//
// Raconte LA visite — jamais le patrimoine du chantier (SitePhotoGallery).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera, Check, ChevronLeft, ChevronRight, History, ImageOff, Loader2,
  Pencil, PenLine, Star, Video, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PhotoAnnotator } from '@/app/(field)/m/site/[siteId]/PhotoAnnotator'
import { addPhotoCaptureAction } from '@/app/(field)/m/site/[siteId]/capture-actions'
import { uploadReportAttachmentAction } from '@/app/(field)/m/site/[siteId]/report-actions'
import { updateVisitPhotoCaptionAction, getAnnotatedOriginalAction } from './photo-actions'

export interface VisitPhotoItem {
  id: string
  kind: 'photo' | 'video'
  /** URL signée — null si la pièce est introuvable (on l'affiche, on ne ment pas). */
  url: string | null
  mime: string | null
  caption: string | null
  /** Photo clé (mig 174) — c'est elle que le CR/PDF privilégie. */
  starred: boolean
  /** Version annotée (mig 185) — pointe la photo d'origine, archivée mais consultable. */
  annotatedOriginalId: string | null
  /** Instant réel de la capture, pour l'annotée : repris de l'original. */
  capturedAt: string | null
}

export function VisitPhotosSection({ siteId, reportId, photos }: {
  siteId: string
  reportId: string
  photos: VisitPhotoItem[]
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (photos.length === 0) {
    return (
      <section id="photos" className="rounded-xl border bg-card p-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Camera className="h-4 w-4 text-sky-600" aria-hidden /> Photos de la visite
        </h2>
        {/* État vide AFFICHÉ (le système a vérifié) — et la porte vers le geste
            d'ajout existant : on ne recrée pas d'uploader. */}
        <p className="mt-2 text-[13px] text-muted-foreground">
          Aucune photo dans cette visite. Vous pouvez en verser une via « Verser une pièce au dossier », dans la colonne de droite.
        </p>
      </section>
    )
  }

  return (
    <section id="photos" className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Camera className="h-4 w-4 text-sky-600" aria-hidden /> Photos de la visite
        <span className="text-xs font-normal text-muted-foreground">
          {photos.length} · cliquez pour agrandir, annoter, légender
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="group text-left"
            aria-label={`Ouvrir la ${p.kind === 'video' ? 'vidéo' : 'photo'} ${i + 1}`}
          >
            <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
              {p.url ? (
                p.kind === 'video' ? (
                  <video src={p.url} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.caption ?? ''} className="h-full w-full object-cover transition-opacity group-hover:opacity-90" />
                )
              ) : (
                <div className="grid h-full w-full place-items-center text-muted-foreground">
                  <ImageOff className="h-6 w-6" aria-hidden />
                </div>
              )}
              <div className="absolute left-1.5 top-1.5 flex gap-1">
                {p.kind === 'video' && (
                  <span className="rounded bg-black/60 p-1 text-white"><Video className="h-3 w-3" aria-hidden /></span>
                )}
                {p.annotatedOriginalId && (
                  <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Annotée</span>
                )}
              </div>
              {p.starred && (
                <span title="Photo clé — privilégiée dans le compte-rendu" className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-amber-300">
                  <Star className="h-3 w-3 fill-current" aria-hidden />
                </span>
              )}
            </div>
            {p.caption && <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{p.caption}</p>}
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <PhotoViewer
          siteId={siteId}
          reportId={reportId}
          photos={photos}
          index={openIndex}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </section>
  )
}

// ── La VISIONNEUSE — grande image, navigation, légende, annotation ───────────

function PhotoViewer({ siteId: _siteId, reportId, photos, index, onNavigate, onClose }: {
  siteId: string
  reportId: string
  photos: VisitPhotoItem[]
  index: number
  onNavigate: (i: number) => void
  onClose: () => void
}) {
  const router = useRouter()
  const photo = photos[index]
  const total = photos.length
  const [annotating, setAnnotating] = useState(false)
  // L'original d'une version annotée, chargé à la demande (il est archivé,
  // donc absent de la liste) — affiché DANS la visionneuse, lecture seule.
  const [original, setOriginal] = useState<{ url: string; caption: string | null } | null>(null)
  const [loadingOriginal, setLoadingOriginal] = useState(false)

  const go = useCallback((delta: number) => {
    setOriginal(null)
    onNavigate((index + delta + total) % total)
  }, [index, total, onNavigate])

  // Clavier : ← → naviguent, Échap ferme. Pas quand l'annotateur est ouvert
  // (il occupe l'écran et a ses propres gestes).
  useEffect(() => {
    if (annotating) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && total > 1) go(-1)
      else if (e.key === 'ArrowRight' && total > 1) go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotating, go, onClose, total])

  async function voirOriginal() {
    if (loadingOriginal) return
    setLoadingOriginal(true)
    const res = await getAnnotatedOriginalAction({ report_id: reportId, capture_id: photo.id })
    setLoadingOriginal(false)
    if (res.ok) setOriginal({ url: res.url, caption: res.caption })
    else toast.error(res.error)
  }

  // La sauvegarde d'annotation = EXACTEMENT le chemin mobile (CaptureTriage) :
  // upload de la pièce, puis nouvelle capture starred liée à l'original —
  // « Remplacer l'affichage » archive l'original (jamais supprimé).
  async function saveAnnotation(file: File, replaceOriginal: boolean) {
    try {
      const fd = new FormData()
      fd.set('report_id', reportId)
      fd.set('kind', 'photo')
      fd.set('client_uuid', crypto.randomUUID())
      fd.set('file', file)
      const up = await uploadReportAttachmentAction(fd)
      if (!up.ok) { toast.error(up.error); return }
      const cap = await addPhotoCaptureAction({
        report_id: reportId,
        site_id: _siteId,
        attachment_id: up.attachmentId,
        starred: true,
        ...(replaceOriginal ? { replaces_capture_id: photo.id } : {}),
        ...(photo.capturedAt ? { captured_at: photo.capturedAt } : {}),
      })
      if (!cap.ok) { toast.error(cap.error); return }
      setAnnotating(false)
      onClose()
      toast.success('Photo annotée ajoutée — elle entre au compte-rendu comme photo clé.')
      router.refresh()
    } catch {
      toast.error('Échec de l’enregistrement de l’annotation')
    }
  }

  const shown = original ?? { url: photo.url ?? '', caption: photo.caption }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Photos de la visite">
      {/* Barre haute : compteur + état + fermeture. */}
      <div className="flex items-center justify-between px-4 py-2.5 text-white">
        <span className="text-sm tabular-nums">{index + 1} / {total}</span>
        <div className="flex items-center gap-2 text-[12px]">
          {original && <span className="rounded bg-white/15 px-2 py-0.5">Original — avant annotation</span>}
          {!original && photo.annotatedOriginalId && <span className="rounded bg-white/15 px-2 py-0.5">Version annotée</span>}
          {!original && photo.starred && (
            <span className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-amber-300">
              <Star className="h-3 w-3 fill-current" aria-hidden /> Photo clé du CR
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* L'image, grande — les flèches restent visibles de chaque côté. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
        {total > 1 && (
          <button
            type="button" onClick={() => go(-1)} aria-label="Photo précédente"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {shown.url ? (
          photo.kind === 'video' && !original ? (
            <video src={shown.url} controls autoPlay className="max-h-full max-w-full rounded-lg" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={shown.caption ?? ''} className="max-h-full max-w-full rounded-lg object-contain" />
          )
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/70">
            <ImageOff className="h-8 w-8" aria-hidden />
            <p className="text-sm">Le fichier de cette {photo.kind === 'video' ? 'vidéo' : 'photo'} est introuvable.</p>
          </div>
        )}
        {total > 1 && (
          <button
            type="button" onClick={() => go(1)} aria-label="Photo suivante"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bas : légende éditable + gestes. */}
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4 pt-2">
        {original ? (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[13px] text-white/80">{original.caption || 'Sans légende'}</p>
            <button
              type="button" onClick={() => setOriginal(null)}
              className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/20"
            >
              Revenir à la version annotée
            </button>
          </div>
        ) : (
          <>
            <CaptionEditor key={photo.id} reportId={reportId} captureId={photo.id} caption={photo.caption} onSaved={() => router.refresh()} />
            <div className="flex flex-wrap items-center gap-2">
              {photo.kind === 'photo' && photo.url && (
                <button
                  type="button" onClick={() => setAnnotating(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black hover:bg-white/90"
                >
                  <PenLine className="h-4 w-4" aria-hidden /> Annoter
                </button>
              )}
              {photo.annotatedOriginalId && (
                <button
                  type="button" onClick={voirOriginal} disabled={loadingOriginal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/20 disabled:opacity-50"
                >
                  {loadingOriginal ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
                  Voir l’original
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* L'annotateur MOBILE, tel quel : plein écran (z-80 > visionneuse), grande
          zone de travail, Pointer Events — la souris est native. */}
      {annotating && photo.url && (
        <PhotoAnnotator
          imageUrl={photo.url}
          onCancel={() => setAnnotating(false)}
          onSave={saveAnnotation}
        />
      )}
    </div>
  )
}

// ── La LÉGENDE — même colonne que le mobile (visit_capture.body) ─────────────

function CaptionEditor({ reportId, captureId, caption, onSaved }: {
  reportId: string
  captureId: string
  caption: string | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(caption ?? '')
  const [pending, setPending] = useState(false)
  // La valeur affichée après sauvegarde, sans attendre le refresh serveur.
  const [saved, setSaved] = useState(caption ?? '')

  async function save() {
    if (pending) return
    setPending(true)
    const res = await updateVisitPhotoCaptionAction({ report_id: reportId, capture_id: captureId, caption: value })
    setPending(false)
    if (res.ok) {
      setSaved(value.trim())
      setEditing(false)
      onSaved()
    } else toast.error(res.error)
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className={`min-w-0 truncate text-[13px] ${saved ? 'text-white/90' : 'italic text-white/50'}`}>
          {saved || 'Sans légende'}
        </p>
        <button
          type="button" onClick={() => { setValue(saved); setEditing(true) }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-white/20"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden /> {saved ? 'Modifier la légende' : 'Ajouter une légende'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        autoFocus
        maxLength={500}
        placeholder="Ex. Fissure au plafond — chambre 2"
        className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[13px] text-white placeholder:text-white/40"
      />
      <button
        type="button" onClick={save} disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        Enregistrer
      </button>
      <button
        type="button" onClick={() => setEditing(false)} disabled={pending}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10"
      >
        Annuler
      </button>
    </div>
  )
}
