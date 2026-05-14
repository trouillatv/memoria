'use client'

import { useRef, useState, useTransition } from 'react'
import { Camera, AlertTriangle, Check } from 'lucide-react'
import { toast } from 'sonner'
import { queuePhoto } from '@/lib/field/photo-queue'

/**
 * V5.1 Slice 1 — Panel de capture spontanée pour le dépôt de trace libre
 * sur un site.
 *
 * Flow :
 *   1. État initial : bouton "📷 Photo" 80px sticky bottom, pleine largeur
 *   2. Tap → input file accept="image/*" capture="environment" → caméra native
 *   3. Photo prise → preview + 2 boutons sticky 80px : "✓ Passage" / "🚨 Anomalie"
 *   4. Tap un bouton → queuePhoto({siteId, intent, blob, clientUuid auto}) → reset
 *   5. Sync silencieuse en background (usePhotoUploader sur la page parent ou
 *      ailleurs — la queue est globale)
 *
 * Grammaire sensorielle :
 *   - Touch target 80px sur tous les boutons critiques
 *   - --scar (#8a3030) en bordure UNIQUEMENT sur le bouton Anomalie (jamais fond)
 *   - Pas de "Bravo" / "Photo enregistrée avec succès !" — juste "Trace déposée"
 *     1.5s, descriptif neutre
 *   - Pas d'animation flashy, pas de confettis, pas de progress bar
 */

type CapturedPhoto = { blob: Blob; previewUrl: string } | null

export function SpontaneousCapturePanel({ siteId }: { siteId: string }) {
  const [photo, setPhoto] = useState<CapturedPhoto>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function openCamera() {
    inputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset pour permettre re-shoot
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setPhoto({ blob: file, previewUrl })
  }

  function cancelPhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl)
    setPhoto(null)
  }

  function deposit(intent: 'passage' | 'anomaly') {
    if (!photo) return
    startTransition(async () => {
      try {
        await queuePhoto({
          blob: photo.blob,
          filename: `${intent}-${Date.now()}.jpg`,
          mimeType: photo.blob.type || 'image/jpeg',
          checklistItemId: null,
          siteId,
          intent,
          kind: intent === 'anomaly' ? 'anomaly' : 'passage',
          // clientUuid généré automatiquement par queuePhoto pour les modes spontanés
        })
        URL.revokeObjectURL(photo.previewUrl)
        setPhoto(null)
        // Wording sec descriptif — pas de "bravo", pas de "succès".
        toast.success('Trace déposée', { duration: 1500 })
      } catch (err) {
        console.error('[queueSpontaneousPhoto]', err)
        toast.error('Erreur lors de la sauvegarde')
      }
    })
  }

  // État 1 : bouton photo (sticky bottom, pleine largeur, 80px)
  if (!photo) {
    return (
      <>
        <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom">
          <button
            type="button"
            onClick={openCamera}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background font-semibold text-base active:scale-[0.98] transition-transform shadow-lg"
            style={{ minHeight: 80 }}
          >
            <Camera className="h-6 w-6" />
            Photo
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChange}
          className="hidden"
        />
      </>
    )
  }

  // État 2 : photo prise, choix Passage / Anomalie
  return (
    <div className="fixed inset-x-0 bottom-0 p-4 bg-background border-t safe-bottom space-y-3">
      {/* Aperçu compact en haut du panel — l'utilisateur a vu la photo en
          plein écran via la caméra, ici c'est une confirmation visuelle. */}
      <div className="rounded-lg overflow-hidden border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.previewUrl}
          alt="Aperçu"
          className="w-full max-h-40 object-cover"
        />
      </div>
      <button
        type="button"
        onClick={() => deposit('passage')}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background font-semibold text-base active:scale-[0.98] transition-transform shadow-lg disabled:opacity-60"
        style={{ minHeight: 80 }}
      >
        <Check className="h-6 w-6" />
        Passage
      </button>
      <button
        type="button"
        onClick={() => deposit('anomaly')}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 font-semibold text-base active:scale-[0.98] transition-transform disabled:opacity-60"
        style={{
          minHeight: 80,
          borderColor: '#8a3030', // V5.1 palette --scar (à graver en CSS var dans une slice future)
          color: '#8a3030',
        }}
      >
        <AlertTriangle className="h-6 w-6" />
        Anomalie
      </button>
      <button
        type="button"
        onClick={cancelPhoto}
        disabled={pending}
        className="w-full text-sm text-muted-foreground py-2"
      >
        Reprendre la photo
      </button>
    </div>
  )
}
