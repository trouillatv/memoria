'use client'

import { useMemo, useState, useTransition } from 'react'
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
  otherSites?: Array<{ id: string; name: string; contract_name: string | null; contract_id?: string | null }>
  /** Engagements Porte A actifs/complétés, groupés par contract_id (P0-3.5A). */
  contractEngagements: Record<string, DbEngagement[]>
  /** Engagements Porte B actifs/complétés, groupés par site_id (P0-3.5A). */
  siteEngagements: Record<string, DbEngagement[]>
  /** Engagements déjà liés à la mission mais sortis de la population cible
   *  courante — affichés pour préserver l'existant, jamais pour permettre un
   *  nouveau rattachement en dehors de la population courante (P0-3.5A). */
  preservedEngagements?: DbEngagement[]
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

export function MissionEditor({ mode, contractId, sites, otherSites, contractEngagements, siteEngagements, preservedEngagements, initialMission, defaultSiteId }: MissionEditorProps) {
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

  // Population cible pour le site sélectionné : Engagements Porte A actifs du
  // contrat de ce site ∪ Engagements Porte B actifs de ce site lui-même
  // (P0-3.5A). Recalculée à chaque changement de site (SiteSelector, y
  // compris "otherSites" cross-contrat).
  const allSitesById = useMemo(() => {
    const m = new Map<string, { id: string; contract_id?: string | null }>()
    for (const s of sites) m.set(s.id, s)
    for (const s of otherSites ?? []) m.set(s.id, s)
    return m
  }, [sites, otherSites])

  const visibleEngagements = useMemo(() => {
    const site = allSitesById.get(siteId)
    const byId = new Map<string, DbEngagement>()
    if (site?.contract_id) {
      for (const e of contractEngagements[site.contract_id] ?? []) byId.set(e.id, e)
    }
    for (const e of siteEngagements[siteId] ?? []) byId.set(e.id, e)
    return Array.from(byId.values())
  }, [siteId, allSitesById, contractEngagements, siteEngagements])

  // Union avec les Engagements déjà liés mais hors population courante : on
  // les préserve à l'affichage sans permettre de nouveau rattachement en
  // dehors de la population cible (eux seuls comblent l'écart).
  const displayEngagements = useMemo(() => {
    const byId = new Map<string, DbEngagement>()
    for (const e of visibleEngagements) byId.set(e.id, e)
    for (const e of preservedEngagements ?? []) byId.set(e.id, e)
    return Array.from(byId.values())
  }, [visibleEngagements, preservedEngagements])

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

    // FIX_REQUIRED P0-3.5A #3 : le site sélectionné peut appartenir à un
    // AUTRE contrat que celui de la route (réutilisation cross-contrat via
    // "Autres sites du tenant"). Rediriger vers le contrat RÉEL du site,
    // jamais vers celui de la route — sinon la mission créée sur B apparaît
    // comme perdue depuis la liste des missions de A.
    const targetContractId = allSitesById.get(siteId)?.contract_id ?? null
    const missionsListHref = targetContractId
      ? `/contracts/${targetContractId}/missions`
      : '/missions'

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
        router.push(missionsListHref)
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
        router.push(missionsListHref)
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Identification */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Identification</h3>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Chantier *</label>
          <SiteSelector
            sites={sites.map((s) => ({ id: s.id, name: s.name, contract_id: s.contract_id }))}
            otherSites={otherSites}
            value={siteId}
            onChange={setSiteId}
            disabled={mode === 'edit' || pending}
          />
          {mode === 'edit' && (
            <p className="text-[11px] text-muted-foreground italic">Le chantier n&apos;est pas modifiable après création.</p>
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

        {displayEngagements.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Aucune promesse active sur ce chantier.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {displayEngagements.map((e) => {
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
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={item.required ?? false} onChange={(e) => updateChecklistItem(idx, { required: e.target.checked })} disabled={pending} />
                      Obligatoire
                    </label>
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.expected_qty != null}
                        onChange={(e) => updateChecklistItem(idx, { expected_qty: e.target.checked ? 1 : null })}
                        disabled={pending}
                      />
                      À quantité
                    </label>
                    {item.expected_qty != null && (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-muted-foreground">Prévu</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={item.expected_qty}
                          onChange={(e) => updateChecklistItem(idx, { expected_qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                          disabled={pending}
                          className="w-20 rounded border p-1 text-xs"
                        />
                      </span>
                    )}
                    <select
                      value={item.engagement_id ?? ''}
                      onChange={(e) => updateChecklistItem(idx, { engagement_id: e.target.value || undefined })}
                      disabled={pending}
                      className="rounded border p-1 text-xs bg-background"
                    >
                      <option value="">— pas d&apos;engagement lié —</option>
                      {displayEngagements.map((eng) => (
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
