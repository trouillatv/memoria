'use client'

// P0-3.1A (mandat Vincent 2026-09-25) — création manuelle d'un Engagement
// Porte B depuis Prestations prévues, sans document contractuel. UN SEUL
// composant, partagé desktop/mobile : mêmes champs, même validation, même
// server action (app/(dashboard)/sites/[id]/prestations/actions.ts).
//
// Volontairement absent de ce formulaire : fréquence structurée, calendrier,
// équipe, checklist, Mission/occurrence (hors périmètre P0-3.1A — la
// fréquence éventuelle se décrit dans la description, en texte libre).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CATEGORY_LABELS, categoryLabel } from '@/lib/engagements/labels'
import { KIND_ORDER, kindLabel } from '@/lib/engagements/kind'
import type { EngagementCategory, EngagementKind } from '@/types/db'
import { createPlannedEngagementManualAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'

export function AddPlannedEngagementDialog({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<EngagementCategory | ''>('')
  const [kind, setKind] = useState<EngagementKind | 'none'>('none')
  const [measurable, setMeasurable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setLabel('')
    setDescription('')
    setCategory('')
    setKind('none')
    setMeasurable(false)
    setError(null)
  }

  function submit() {
    setError(null)
    if (!label.trim() || !category) {
      setError('Libellé et catégorie sont requis')
      return
    }
    start(async () => {
      const res = await createPlannedEngagementManualAction({
        site_id: siteId,
        short_label: label.trim(),
        source_excerpt: description.trim() || null,
        category,
        kind: kind === 'none' ? null : kind,
        measurable,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Engagement ajouté')
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" /> Ajouter un engagement
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un engagement</DialogTitle>
          <DialogDescription>
            Créé manuellement, sans document — reste « à mettre en vigueur » jusqu&apos;à activation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="engagement-label">Libellé</Label>
            <Input
              id="engagement-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex. Nettoyage hebdomadaire des vitres"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="engagement-description">Description / ce qui doit être vrai</Label>
            <Textarea
              id="engagement-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optionnel — peut décrire une fréquence en texte libre"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as EngagementCategory)}>
              <SelectTrigger className="w-full">
                {/* base-ui SelectValue n'affiche le libellé traduit que si on le
                    lui fournit explicitement (sinon il retombe sur la valeur
                    brute stockée, ex. "frequency" au lieu de "Fréquence"). */}
                <SelectValue>
                  {(v: EngagementCategory | '') => (v ? categoryLabel(v) : 'Choisir…')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as EngagementCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Nature</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as EngagementKind | 'none')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: EngagementKind | 'none') => kindLabel(v === 'none' ? null : v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Non typé</SelectItem>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>{kindLabel(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="engagement-measurable">Mesurable</Label>
            <Switch id="engagement-measurable" checked={measurable} onCheckedChange={(v) => setMeasurable(!!v)} />
          </div>

          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Annuler</DialogClose>
          <Button onClick={submit} disabled={pending || !label.trim() || !category}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
