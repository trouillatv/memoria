'use client'

import { useRef, useTransition } from 'react'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { queuePhoto } from '@/lib/field/photo-queue'

interface Props {
  interventionId: string
  checklistItemId: string | null
  anomalyId?: string | null
  kind: 'before' | 'after' | 'anomaly' | 'proof'
  label: string
  disabled?: boolean
  onPhotoQueued?: () => void  // callback for parent to refresh local thumbs
  /** Variantes :
   *  - `default` : bouton inline classique
   *  - `fab` : floating action button rond (position fixed à appliquer par parent)
   *  - `fullwidth` : J2 — bouton pleine-largeur 80px, parent applique position sticky bottom */
  variant?: 'default' | 'fab' | 'fullwidth'
}

export function PhotoCaptureButton({
  interventionId,
  checklistItemId,
  anomalyId,
  kind,
  label,
  disabled,
  onPhotoQueued,
  variant = 'default',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    inputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset for re-shoot
    if (!file) return

    startTransition(async () => {
      try {
        await queuePhoto({
          blob: file,
          filename: file.name || `photo-${Date.now()}.jpg`,
          mimeType: file.type || 'image/jpeg',
          interventionId,
          checklistItemId,
          anomalyId: anomalyId ?? null,
          kind,
        })
        onPhotoQueued?.()
        // Discreet feedback — short, non-anxiogenic
        toast.success('Photo enregistrée', { duration: 1500 })
      } catch (err) {
        toast.error('Erreur lors de la sauvegarde')
        console.error('[queuePhoto]', err)
      }
    })
  }

  const isFab = variant === 'fab'
  const isFullWidth = variant === 'fullwidth'

  // Styles par variante. `fullwidth` (J2 Doctrine V5 Pilier 5) : 80px de haut,
  // pleine largeur, texte gros, cible doigt + gants + humidité optimisée.
  let className: string
  let style: React.CSSProperties
  if (isFab) {
    className =
      'inline-flex items-center justify-center rounded-full bg-foreground text-background shadow-lg active:scale-95 transition-transform disabled:opacity-60 size-14'
    style = { minHeight: 56 }
  } else if (isFullWidth) {
    className =
      'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background font-semibold text-base active:scale-[0.98] transition-transform shadow-lg disabled:opacity-60'
    style = { minHeight: 80 }
  } else {
    className =
      'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border bg-card active:bg-muted text-sm font-medium disabled:opacity-50'
    style = { minHeight: 52 }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        aria-label={isFab ? label : undefined}
        className={className}
        style={style}
      >
        <Camera className={isFab || isFullWidth ? 'h-6 w-6' : 'h-4 w-4'} />
        {!isFab && label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  )
}
