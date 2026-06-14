'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createAnomalyMobileAction } from './actions'
import { PhotoCaptureButton } from './photo-capture-button'
import type { AnomalyCategory } from '@/types/db'

interface Props {
  interventionId: string
  open: boolean
  onClose: () => void
}

const CATEGORIES: { value: AnomalyCategory; label: string; icon: string }[] = [
  { value: 'acces_bloque',       label: 'Accès impossible',   icon: '🚪' },
  { value: 'eau_coupee',         label: 'Eau coupée',         icon: '🚱' },
  { value: 'electricite_coupee', label: 'Électricité coupée', icon: '⚡' },
  { value: 'zone_non_prete',     label: 'Zone non prête',     icon: '🚧' },
  { value: 'materiel_casse',     label: 'Matériel manquant',  icon: '🧰' },
  { value: 'danger_securite',    label: 'Danger / sécurité',  icon: '⚠️' },
  { value: 'livraison_probleme', label: 'Livraison problème', icon: '📦' },
  { value: 'autre',              label: 'Autre',              icon: '✏️' },
]

export function AnomalyModal({ interventionId, open, onClose }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<AnomalyCategory | null>(null)
  const [categoryOther, setCategoryOther] = useState('')
  const [description, setDescription] = useState('')
  const [createdAnomalyId, setCreatedAnomalyId] = useState<string | null>(null)

  function reset() {
    setCategory(null)
    setCategoryOther('')
    setDescription('')
    setCreatedAnomalyId(null)
  }

  function handleClose() {
    reset()
    onClose()
    router.refresh()
  }

  function submit() {
    if (!category) {
      toast.error('Choisissez une catégorie')
      return
    }
    if (category === 'autre' && !categoryOther.trim()) {
      toast.error('Précisez ce qu\'il s\'est passé')
      return
    }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('category', category)
    if (category === 'autre' && categoryOther.trim()) {
      fd.set('category_other', categoryOther.trim())
    }
    if (description.trim()) fd.set('description', description.trim())

    startTransition(async () => {
      const r = await createAnomalyMobileAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Signalement envoyé', { duration: 1500 })
        const anomalyId = r && 'anomalyId' in r ? r.anomalyId : null
        if (anomalyId) {
          setCreatedAnomalyId(anomalyId)
        } else {
          reset()
          onClose()
        }
        router.refresh()
      }
    })
  }

  if (!open) return null

  if (createdAnomalyId) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <header className="sticky top-0 z-10 bg-background border-b">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1 text-sm active:text-muted-foreground"
              style={{ minHeight: 44 }}
            >
              <ArrowLeft className="h-4 w-4" />
              Terminer
            </button>
            <span className="text-sm font-semibold">Signalement envoyé</span>
            <span className="w-16" aria-hidden />
          </div>
        </header>
        <div className="p-4 space-y-5 max-w-md mx-auto">
          <p className="text-sm text-muted-foreground">
            Voulez-vous joindre une photo à ce signalement ?
          </p>
          <PhotoCaptureButton
            interventionId={interventionId}
            checklistItemId={null}
            anomalyId={createdAnomalyId}
            kind="anomaly"
            label="Prendre une photo"
            variant="fullwidth"
            onPhotoQueued={() => { handleClose() }}
          />
          <button
            type="button"
            onClick={handleClose}
            className="w-full px-4 py-3 rounded-xl border text-sm text-muted-foreground"
          >
            Passer sans photo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <header className="sticky top-0 z-10 bg-background border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className="inline-flex items-center gap-1 text-sm active:text-muted-foreground"
            style={{ minHeight: 44 }}
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </button>
          <span className="text-sm font-semibold">Signaler</span>
          <span className="w-12" aria-hidden />
        </div>
      </header>

      <div className="p-4 space-y-5 max-w-md mx-auto">
        <div>
          <h2 className="text-base font-semibold mb-3">Que s&apos;est-il passé&nbsp;?</h2>
          <div className="space-y-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                disabled={pending}
                className={`w-full flex items-center gap-3 rounded-xl border p-4 text-left active:bg-muted/40 disabled:opacity-50 ${
                  category === cat.value
                    ? 'border-foreground bg-muted/40'
                    : 'border-border bg-card'
                }`}
                style={{ minHeight: 60 }}
              >
                <span className="text-2xl shrink-0">{cat.icon}</span>
                <span className="text-base">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {category === 'autre' && (
          <div className="space-y-2">
            <label htmlFor="anomaly-other" className="text-sm font-medium">
              Précisez
            </label>
            <input
              id="anomaly-other"
              type="text"
              value={categoryOther}
              onChange={(e) => setCategoryOther(e.target.value)}
              maxLength={140}
              disabled={pending}
              className="w-full rounded-lg border p-3 text-base"
              placeholder="Description courte..."
            />
          </div>
        )}

        {category && (
          <>
            <div className="space-y-2">
              <label htmlFor="anomaly-desc" className="text-sm font-medium">
                Détails (optionnel)
              </label>
              <textarea
                id="anomaly-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                disabled={pending}
                className="w-full rounded-lg border p-3 text-base resize-none"
                placeholder="Ce que vous voulez ajouter..."
              />
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={pending || (category === 'autre' && !categoryOther.trim())}
              className="w-full inline-flex items-center justify-center rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:bg-foreground/90 disabled:opacity-50"
              style={{ minHeight: 64 }}
            >
              {pending ? 'Envoi...' : 'Envoyer le signalement'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
