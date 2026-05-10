'use client'

import { useRef, useTransition } from 'react'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { queuePhoto } from '@/lib/field/photo-queue'

interface Props {
  interventionId: string
  checklistItemId: string | null
  kind: 'before' | 'after' | 'anomaly' | 'proof'
  label: string
  disabled?: boolean
  onPhotoQueued?: () => void  // callback for parent to refresh local thumbs
}

export function PhotoCaptureButton({
  interventionId,
  checklistItemId,
  kind,
  label,
  disabled,
  onPhotoQueued,
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

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-card active:bg-muted text-sm font-medium disabled:opacity-50"
        style={{ minHeight: 44 }}
      >
        <Camera className="h-4 w-4" />
        {label}
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
