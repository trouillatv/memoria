'use client'

// Panneau maître-détail : la FICHE COMPLÈTE de l'acteur sélectionné, en face de la
// liste (refonte UI). Zéro clic supplémentaire — le corps de fiche partagé
// (PersonFicheBody / CompanyFicheBody) est le MÊME que la page dédiée. Pour l'équipe,
// la fiche riche vit sur /equipes/[id] : on montre l'essentiel + lien.

import Link from 'next/link'
import { Users, ArrowRight, Clock } from 'lucide-react'
import type { CockpitActor } from '@/lib/db/actors-cockpit'
import type { ActorPreview } from './preview-types'
import { AttentionBadge, FicheSection, FicheLinkRow, FicheEmpty } from './fiche-ui'
import { PersonFicheBody } from './PersonFicheBody'
import { CompanyFicheBody } from './CompanyFicheBody'
import { ActorNetworkExplorer } from './graph/ActorNetworkExplorer'
import type { SelectableKind } from './graph/ActorsGraphCanvas'
import type { TeamActorInsight } from '@/lib/db/team-actor-insight'
import type { ActorsGraph } from '@/lib/knowledge/actors-graph'

const STATUS_LABEL = { active: 'Actif', incomplete: 'Incomplet', historical: 'Historique' } as const

export function ActorPreviewPanel({ actor, preview, loading, onSelectActor }: {
  actor: CockpitActor | null
  preview: ActorPreview
  loading: boolean
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  if (!actor) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        Sélectionnez un acteur pour voir sa fiche.
      </div>
    )
  }

  // Fiche complète disponible → on l'affiche telle quelle (même rendu que la page),
  // réseau (ego-graph) embarqué directement.
  if (preview?.kind === 'person') return <PersonFicheBody fiche={preview.fiche} network={preview.network} onSelectActor={onSelectActor} />
  if (preview?.kind === 'company') return <CompanyFicheBody fiche={preview.fiche} network={preview.network} onSelectActor={onSelectActor} />
  if (preview?.kind === 'team') return <TeamFiche actor={actor} insight={preview.insight} network={preview.network} onSelectActor={onSelectActor} />

  // En cours de chargement (ou aperçu indisponible) → en-tête instantané + squelette.
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{actor.name}</h2>
          <AttentionBadge level={actor.attention.level} />
          {actor.status !== 'active' && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[actor.status]}</span>
          )}
        </div>
        {actor.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{actor.subtitle}</p>}
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : (
        <FicheEmpty>Fiche indisponible.</FicheEmpty>
      )}
    </section>
  )
}

/** Équipe — la fiche riche vit sur /equipes/[id] ; ici l'essentiel + réseau + lien. */
function TeamFiche({ actor, insight, network, onSelectActor }: { actor: CockpitActor; insight: TeamActorInsight; network: ActorsGraph; onSelectActor?: (kind: SelectableKind, id: string) => void }) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
            <Users className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{actor.name}</h1>
              <AttentionBadge level={actor.attention.level} />
              {actor.status !== 'active' && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[actor.status]}</span>
              )}
            </div>
            {actor.subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{actor.subtitle}</p>}
            {insight.attention.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {insight.attention.reasons.map((r) => (
                  <span key={r.code} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{r.label}</span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/equipes/${actor.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-brand-700 hover:border-brand-200 hover:bg-brand-50/40 dark:text-brand-300">
                Ouvrir la fiche équipe <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <FicheSection title="Sujets portés par les membres" count={insight.memberActions.length}>
        {insight.memberActions.length === 0 ? (
          <FicheEmpty>Aucune action portée sur les chantiers actuels de l’équipe.</FicheEmpty>
        ) : (
          insight.memberActions.map((a) => (
            <FicheLinkRow key={a.id} href={a.href} icon={<ArrowRight className="h-4 w-4" aria-hidden />} label={a.title} sub={`${a.contactName} · ${a.siteName}`}
              trailing={a.overdue ? <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-red-700 dark:text-red-400"><Clock className="h-3 w-3" aria-hidden /> En retard</span> : undefined} />
          ))
        )}
      </FicheSection>

      {insight.orphanActions.length > 0 && (
        <FicheSection title="Portées sur un chantier dont l’équipe est sortie">
          {insight.orphanActions.map((a) => (
            <FicheLinkRow key={a.id} href={a.href} icon={<ArrowRight className="h-4 w-4 opacity-60" aria-hidden />} label={a.title} sub={`${a.contactName} · ${a.siteName}`} />
          ))}
        </FicheSection>
      )}

      {network.nodes.length > 1 && (
        <FicheSection title="Réseau de collaboration">
          <ActorNetworkExplorer network={network} focusId={`tm_${actor.id}`} onSelectActor={onSelectActor} />
        </FicheSection>
      )}
    </div>
  )
}
