'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { createMissionAction, updateMissionAction } from '../../../missions-actions'
import { SiteSelector } from './SiteSelector'
import type { DbSite, DbEngagement, DbMission, MissionCadence, ChecklistTemplateItem } from '@/types/db'

interface MissionEditorProps {
  mode: 'create' | 'edit'
  contractId: string
  sites: DbSite[]
  /** Sites du tenant rattachés à d'autres contrats — permet la réutilisation
   *  cross-contrat (ex. un site historique sans nouveau contrat). Optionnel. */
  otherSites?: Array<{ id: string; name: string; contract_name: string | null }>
  engagements: DbEngagement[]
  initialMission?: DbMission
  defaultSiteId?: string
}

const CADENCE_OPTIONS: { value: MissionCadence; label: string }[] = [
  { value: 'daily', label: 'Quotidienne' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'biweekly', label: 'Bimensuelle' },
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'on_demand', label: 'À la demande' },
]

export function MissionEditor({ mode, contractId, sites, otherSites, engagements, initialMission, defaultSiteId }: MissionEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [siteId, setSiteId] = useState(initialMission?.site_id ?? defaultSiteId ?? sites[0]?.id ?? '')
  const [name, setName] = useState(initialMission?.name ?? '')
  const [description, setDescription] = useState(initialMission?.description ?? '')
  const [cadence, setCadence] = useState<MissionCadence>(initialMission?.cadence ?? 'daily')
  const [engagementIds, setEngagementIds] = useState<string[]>(initialMission?.engagement_ids ?? [])
  const [checklist, setChecklist] = useState<ChecklistTemplateItem[]>(
    initialMission?.default_checklist ?? []
  )

  function toggleEngagement(id: string) {
    setEngagementIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function addChecklistItem() {
    setChecklist((prev) => [...prev, { label: '', required: false, position: prev.length + 1 }])
  }

  function updateChecklistItem(idx: number, patch: Partial<ChecklistTemplateItem>) {
    setChecklist((prev) => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function removeChecklistItem(idx: number) {
    setChecklist((prev) => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (!name.trim() || !siteId) {
      toast.error('Site et nom requis')
      return
    }
    const validChecklist = checklist.filter((it) => it.label.trim().length > 0)

    startTransition(async () => {
      const fd = new FormData()
      if (mode === 'edit' && initialMission) {
        fd.set('id', initialMission.id)
        fd.set('name', name.trim())
        fd.set('description', description.trim() || '')
        fd.set('cadence', cadence)
        fd.set('engagement_ids', JSON.stringify(engagementIds))
        fd.set('default_checklist', JSON.stringify(validChecklist))
        const r = await updateMissionAction(fd)
        if (r && 'error' in r && r.error) { toast.error(r.error); return }
        toast.success('Mission mise à jour')
        router.push(`/contracts/${contractId}/missions`)
      } else {
        fd.set('site_id', siteId)
        fd.set('name', name.trim())
        if (description.trim()) fd.set('description', description.trim())
        fd.set('cadence', cadence)
        fd.set('engagement_ids', JSON.stringify(engagementIds))
        fd.set('default_checklist', JSON.stringify(validChecklist))
        const r = await createMissionAction(fd)
        if (r && 'error' in r && r.error) { toast.error(r.error); return }
        toast.success('Mission créée')
        router.push(`/contracts/${contractId}/missions`)
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Identification */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Identification</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Site *</label>
          <SiteSelector
            sites={sites.map((s) => ({ id: s.id, name: s.name }))}
            otherSites={otherSites}
            value={siteId}
            onChange={setSiteId}
            disabled={mode === 'edit' || pending}
          />
          {mode === 'edit' && (
            <p className="text-[11px] text-muted-foreground italic">Le site n&apos;est pas modifiable après création.</p>
          )}
          {mode === 'create' && otherSites && otherSites.length > 0 && (
            <p className="text-[11px] text-muted-foreground italic">
              Vous pouvez réutiliser un site existant d&apos;un autre contrat.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Nom *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={pending} className="w-full rounded border p-2 text-sm" />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Description (optionnel)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} disabled={pending} className="w-full rounded border p-2 text-sm" />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Cadence</label>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as MissionCadence)} disabled={pending} className="w-full rounded border p-2 text-sm bg-background">
            {CADENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Engagement linkage */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">Promesses du contrat couvertes</h3>
          <p className="text-[11px] text-muted-foreground">
            Cochez les promesses contractuelles que cette mission permet de tenir. C&apos;est ce qui alimentera la Boucle de preuve.
          </p>
        </div>

        {engagements.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Aucune promesse active sur ce contrat.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {engagements.map((e) => {
              const checked = engagementIds.includes(e.id)
              return (
                <label key={e.id} className="flex items-start gap-2 p-2 rounded border bg-background hover:bg-muted/30 cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggleEngagement(e.id)} disabled={pending} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{e.short_label}</div>
                    <div className="text-[11px] text-muted-foreground italic line-clamp-1">« {e.source_excerpt} »</div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{engagementIds.length} promesse{engagementIds.length > 1 ? 's' : ''} sélectionnée{engagementIds.length > 1 ? 's' : ''}</p>
      </div>

      {/* Checklist template */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Checklist par défaut</h3>
            <p className="text-[11px] text-muted-foreground">
              Tâches à exécuter à chaque intervention. Vous pourrez lier une tâche à un engagement spécifique pour suivre la preuve.
            </p>
          </div>
          <button type="button" onClick={addChecklistItem} disabled={pending} className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs disabled:opacity-50">
            <Plus className="h-3 w-3" /> Ajouter
          </button>
        </div>

        {checklist.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Aucune tâche. Cliquez « Ajouter » pour commencer.</p>
        ) : (
          <ul className="space-y-2">
            {checklist.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 p-2 rounded border bg-background">
                <GripVertical className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <input
                    value={item.label}
                    onChange={(e) => updateChecklistItem(idx, { label: e.target.value })}
                    placeholder="Tâche (ex: Désinfection sanitaires)"
                    maxLength={200}
                    disabled={pending}
                    className="w-full rounded border p-1.5 text-sm"
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={item.required ?? false} onChange={(e) => updateChecklistItem(idx, { required: e.target.checked })} disabled={pending} />
                      Obligatoire
                    </label>
                    <select
                      value={item.engagement_id ?? ''}
                      onChange={(e) => updateChecklistItem(idx, { engagement_id: e.target.value || undefined })}
                      disabled={pending}
                      className="rounded border p-1 text-xs bg-background"
                    >
                      <option value="">— pas d&apos;engagement lié —</option>
                      {engagements.map((eng) => (
                        <option key={eng.id} value={eng.id}>{eng.short_label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeChecklistItem(idx)}
                  disabled={pending}
                  className="p-1 rounded hover:bg-muted/50 text-muted-foreground shrink-0"
                  aria-label="Retirer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={() => router.push(`/contracts/${contractId}/missions`)} disabled={pending} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim() || !siteId}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
        >
          {pending ? 'Enregistrement...' : mode === 'edit' ? 'Sauver' : 'Créer la mission'}
        </button>
      </div>
    </div>
  )
}
