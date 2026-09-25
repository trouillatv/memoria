// NORM-2 (mandat Vincent 2026-09-25) — carte compacte partagée desktop/mobile
// pour les Prestations prévues. Fonction pure sans hook (nécessaire pour
// rester compatible avec les tests qui marchent l'arbre React non monté en
// invoquant les composants fonction directement).
//
// Compact par défaut : titre, fréquence, kind/category/Mesurable, statut
// seulement quand il distingue la carte au sein de sa section. Document/page/
// extrait/preuves additionnelles vont dans un détail dépliable unique —
// aucune information du read-model n'est supprimée, seulement déplacée.

import Link from 'next/link'
import { CalendarPlus } from 'lucide-react'
import { categoryLabel, plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { KIND_META, kindLabel } from '@/lib/engagements/kind'
import type { EngagementMission, PlannedEngagement } from '@/lib/db/engagements'
import type { EngagementAction } from '@/lib/db/site-action-engagement-links'
import type { MissionHealthTone } from '@/lib/missions/mission-health'
import { ActivateEngagementButton } from '@/components/engagements/ActivateEngagementButton'
import { EngagementTreatPointButton } from '@/components/engagements/EngagementTreatPointButton'
import { buttonVariants } from '@/components/ui/button'

// ENG-UX-1 LOT D (mandat Vincent 2026-09-26) — teintes des chips de santé Mission
// (buildMissionHealth), réutilisées telles quelles. Décrivent l'ORGANISATION de
// l'exécution, jamais l'Engagement lui-même : un Engagement actif reste actif
// quel que soit l'état de ses Missions.
const HEALTH_CHIP_TONE: Record<MissionHealthTone, string> = {
  red: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300',
  orange: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
}

export function PlannedEngagementCard({
  engagement: e,
  showStatusBadge,
  siteId,
  canActivate = false,
  canPlan = false,
  canTreatPoint = false,
  missions = [],
  actions = [],
}: {
  engagement: PlannedEngagement
  showStatusBadge: boolean
  /** P0-3.5B — requis pour construire le lien « Créer une mission » (route
   *  site-first, jamais un contrat forgé). */
  siteId: string
  /** P0-3.2 — CTA « Mettre en vigueur » réservé à managerOrAdmin ; la garde
   *  autoritaire reste côté serveur, ceci n'évite qu'un bouton voué à échouer. */
  canActivate?: boolean
  /** « Créer une mission » (P0-3.5B, renommé ENG-UX-1 LOT E mandat Vincent
   *  2026-09-26 — avant, le CTA disait « Planifier » alors qu'il ne menait
   *  qu'à la création d'une Mission, jamais une intervention datée). Organise
   *  l'exécution normale, distinct de « Traiter un point » (situation
   *  ponctuelle). Une fois une Mission créée, ce CTA disparaît au profit des
   *  liens par Mission (« Voir la mission » / « Planifier la prochaine
   *  intervention », cf. section Organisation ci-dessous). Même politique
   *  managerOrAdmin ; garde autoritaire côté serveur (createMissionAction /
   *  resolveEngagementAuthorization). */
  canPlan?: boolean
  /** « Traiter un point » (mandat Vincent 2026-09-25) — même politique
   *  managerOrAdmin que canActivate ; garde autoritaire côté serveur. */
  canTreatPoint?: boolean
  /** ENG-UX-1 LOT B/D — Missions organisant cet Engagement, batchées côté page.
   *  Plusieurs Missions possibles ; aucune n'affecte le statut de l'Engagement. */
  missions?: EngagementMission[]
  /** ENG-UX-1 LOT C/D — Actions liées (P0-4B) à cet Engagement, batchées côté page. */
  actions?: EngagementAction[]
}) {
  const openActions = actions.filter((a) => a.active)
  const statusBadge = e.status === 'active'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  const kindBadge = e.kind ? KIND_META[e.kind].badge : 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

  return (
    <li className="rounded-xl border bg-card p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{e.shortLabel}</p>
        {showStatusBadge && (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
            {plannedEngagementStatusLabel(e.status)}
          </span>
        )}
      </div>

      {e.primaryProvenance.frequencyRaw && (
        <p className="text-sm font-medium text-foreground">{e.primaryProvenance.frequencyRaw}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindBadge}`}>
          {kindLabel(e.kind)}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {categoryLabel(e.category)}
        </span>
        {e.measurable && (
          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            Mesurable
          </span>
        )}
      </div>

      {e.status === 'curated' && canActivate && (
        <div className="flex justify-end">
          <ActivateEngagementButton engagementId={e.id} />
        </div>
      )}

      {e.status === 'active' && ((canPlan && missions.length === 0) || canTreatPoint) && (
        <div className="flex justify-end gap-1.5">
          {canPlan && missions.length === 0 && (
            <Link
              href={`/sites/${siteId}/missions/new?engagement=${e.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'gap-1.5' })}
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Créer une mission
            </Link>
          )}
          {canTreatPoint && <EngagementTreatPointButton engagementId={e.id} />}
        </div>
      )}

      {(missions.length > 0 || openActions.length > 0) && (
        <div className="space-y-1.5 border-t border-border pt-2">
          {missions.length > 0 && (
            <div className="space-y-1">
              {missions.map((m) => (
                <div key={m.missionId} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-foreground">{m.missionName}</span>
                  {m.health.chips.map((chip, i) => (
                    <span key={i} className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${HEALTH_CHIP_TONE[chip.tone]}`}>
                      {chip.label}
                    </span>
                  ))}
                  <Link href={`/missions/${m.missionId}`} className="text-[11px] font-medium text-primary hover:underline">
                    Voir la mission
                  </Link>
                  {canPlan && !m.nextInterventionDate && (
                    <Link href={`/missions/${m.missionId}`} className="text-[11px] font-medium text-primary hover:underline">
                      Planifier la prochaine intervention
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          {openActions.length > 0 && (
            <Link href={`/sites/${siteId}/actions`} className="inline-block text-[11px] font-medium text-primary hover:underline">
              {openActions.length} action{openActions.length > 1 ? 's' : ''} ouverte{openActions.length > 1 ? 's' : ''}
            </Link>
          )}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Détail &amp; provenance
        </summary>
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {!showStatusBadge && (
            <p className="text-[11px] font-medium text-muted-foreground">
              Statut :{' '}
              <span className={`rounded-full border px-2 py-0.5 ${statusBadge}`}>
                {plannedEngagementStatusLabel(e.status)}
              </span>
            </p>
          )}
          <ProvenanceLine provenance={e.primaryProvenance} />
          {e.additionalProvenance.map((p, i) => (
            <ProvenanceLine key={i} provenance={p} />
          ))}
        </div>
      </details>
    </li>
  )
}

export function ProvenanceLine({ provenance: p }: { provenance: PlannedEngagement['primaryProvenance'] }) {
  // P0-3.1A — un Engagement Porte B manuel n'a, PAR CONSTRUCTION, aucun document
  // (documentId null). Le laisser tomber sur le libellé générique « Document »
  // affirmerait une provenance documentaire fictive : dire « Créé manuellement ».
  const source = p.documentId
    ? [p.documentFilename ?? 'Document', p.pageNumber ? `p.${p.pageNumber}` : null].filter(Boolean).join(' · ')
    : 'Créé manuellement'
  return (
    <div className="space-y-0.5">
      <p className="truncate text-xs text-muted-foreground">{source}</p>
      {p.excerpt && <p className="text-xs italic text-muted-foreground/80 line-clamp-2">« {p.excerpt} »</p>}
    </div>
  )
}
