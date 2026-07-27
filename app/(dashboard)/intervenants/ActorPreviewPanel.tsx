'use client'

// Panneau maître-détail : aperçu VIVANT de l'acteur sélectionné (refonte UI 2026-07-27).
// Réutilise les primitives de fiche partagées → cohérence visuelle avec les fiches
// complètes. Ne recopie pas tout : montre l'essentiel + « Voir la fiche complète ».

import Link from 'next/link'
import { User, Building2, Users, MapPin, ArrowRight, Clock, Mail, Phone } from 'lucide-react'
import type { CockpitActor } from '@/lib/db/actors-cockpit'
import type { ActorPreview } from './preview-types'
import { AttentionBadge, FicheSection, FicheRow, FicheLinkRow, FicheEmpty } from './fiche-ui'

const STATUS_LABEL = { active: 'Actif', incomplete: 'Incomplet', historical: 'Historique' } as const
const KIND_ICON = { person: User, company: Building2, team: Users }
const CAP = 5

export function ActorPreviewPanel({ actor, preview, loading }: { actor: CockpitActor | null; preview: ActorPreview; loading: boolean }) {
  if (!actor) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        Sélectionnez un acteur pour voir son aperçu.
      </div>
    )
  }
  const Icon = KIND_ICON[actor.kind]

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
      {/* En-tête — instantané depuis la liste (même politique d'état). */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{actor.name}</h2>
            <AttentionBadge level={actor.attention.level} />
            {actor.status !== 'active' && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[actor.status]}</span>
            )}
          </div>
          {actor.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{actor.subtitle}</p>}
          {actor.attention.reasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {actor.attention.reasons.map((r) => (
                <span key={r.code} className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{r.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && !preview ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : preview?.kind === 'person' ? (
        <PersonPreview fiche={preview.fiche} />
      ) : preview?.kind === 'company' ? (
        <CompanyPreview fiche={preview.fiche} />
      ) : preview?.kind === 'team' ? (
        <TeamPreview insight={preview.insight} teamId={actor.id} />
      ) : (
        <FicheEmpty>Aperçu indisponible.</FicheEmpty>
      )}
    </div>
  )
}

function More({ n }: { n: number }) {
  return n > 0 ? <p className="px-1.5 pt-1 text-xs text-muted-foreground">+{n} autre{n > 1 ? 's' : ''}…</p> : null
}

function FullLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
      Voir la fiche complète <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  )
}

function ActionLink({ a }: { a: { id: string; title: string; siteName: string; overdue: boolean; dueDate: string | null; href: string } }) {
  return (
    <FicheLinkRow
      href={a.href}
      icon={<ArrowRight className="h-4 w-4" aria-hidden />}
      label={a.title}
      sub={a.siteName}
      trailing={a.overdue
        ? <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-red-700 dark:text-red-400"><Clock className="h-3 w-3" aria-hidden /> En retard</span>
        : a.dueDate ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{a.dueDate}</span> : undefined}
    />
  )
}

function PersonPreview({ fiche }: { fiche: import('@/lib/db/person-fiche').PersonFiche }) {
  const activeTeams = fiche.teams.filter((t) => t.active)
  const activeCasting = fiche.casting.filter((c) => c.active)
  return (
    <div className="space-y-3">
      {(fiche.email || fiche.phone || fiche.mobile) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {fiche.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden /> {fiche.email}</span>}
          {(fiche.phone || fiche.mobile) && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden /> {[fiche.phone, fiche.mobile].filter(Boolean).join(' · ')}</span>}
        </div>
      )}
      <FicheSection title="Organisation">
        {fiche.companyName && <FicheRow icon={<Building2 className="h-4 w-4" aria-hidden />} label={fiche.companyName} sub="Entreprise" />}
        {activeTeams.slice(0, CAP).map((t) => <FicheLinkRow key={t.id} href={t.href} icon={<Users className="h-4 w-4" aria-hidden />} label={t.name} sub="Équipe" />)}
        {activeCasting.slice(0, CAP).map((c) => <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Casting · ${c.role}`} />)}
        {!fiche.companyName && activeTeams.length === 0 && activeCasting.length === 0 && <FicheEmpty>Aucun rattachement actif.</FicheEmpty>}
      </FicheSection>
      <FicheSection title="Travail en cours" count={fiche.actionsAsReferent.length}>
        {fiche.actionsAsReferent.length === 0 ? <FicheEmpty>Aucune action ouverte.</FicheEmpty> : (
          <>{fiche.actionsAsReferent.slice(0, CAP).map((a) => <ActionLink key={a.id} a={a} />)}<More n={fiche.actionsAsReferent.length - CAP} /></>
        )}
      </FicheSection>
      <FullLink href={`/intervenants/personne/${fiche.id}`} />
    </div>
  )
}

function CompanyPreview({ fiche }: { fiche: import('@/lib/db/company-fiche').CompanyFiche }) {
  return (
    <div className="space-y-3">
      <FicheSection title="Présence opérationnelle" count={fiche.activeCasting.length}>
        {fiche.activeCasting.length === 0 ? <FicheEmpty>Aucun chantier actif.</FicheEmpty> : (
          <>{fiche.activeCasting.slice(0, CAP).map((c) => <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Rôle · ${c.role}`} />)}<More n={fiche.activeCasting.length - CAP} /></>
        )}
      </FicheSection>
      <FicheSection title="Travail en cours" count={fiche.openCount}>
        {fiche.actions.length === 0 ? <FicheEmpty>Aucune action ouverte.</FicheEmpty> : (
          <>{fiche.actions.slice(0, CAP).map((a) => <ActionLink key={a.id} a={a} />)}<More n={fiche.actions.length - CAP} /></>
        )}
      </FicheSection>
      <FullLink href={`/intervenants/entreprise/${fiche.id}`} />
    </div>
  )
}

function TeamPreview({ insight, teamId }: { insight: import('@/lib/db/team-actor-insight').TeamActorInsight; teamId: string }) {
  return (
    <div className="space-y-3">
      <FicheSection title="Sujets portés par les membres" count={insight.memberActions.length}>
        {insight.memberActions.length === 0 ? <FicheEmpty>Aucune action portée sur les chantiers actuels.</FicheEmpty> : (
          <>{insight.memberActions.slice(0, CAP).map((a) => (
            <FicheLinkRow key={a.id} href={a.href} icon={<ArrowRight className="h-4 w-4" aria-hidden />} label={a.title} sub={`${a.contactName} · ${a.siteName}`}
              trailing={a.overdue ? <span className="shrink-0 text-xs font-medium text-red-700 dark:text-red-400">En retard</span> : undefined} />
          ))}<More n={insight.memberActions.length - CAP} /></>
        )}
      </FicheSection>
      <FullLink href={`/equipes/${teamId}`} />
    </div>
  )
}
