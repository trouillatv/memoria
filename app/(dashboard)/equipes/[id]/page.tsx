// Sprint Équipes B (Vincent 2026-05-21) — Fiche équipe enrichie.
//
// Route /equipes/[id] — admin + manager. Le chef d'équipe est redirigé vers /m
// par le layout (dashboard) (belt + suspenders ici via la garde explicite).
//
// Doctrine V2 — la fiche est descriptive, jamais évaluative :
//   - Compteurs cumulés (sites, contrats, interventions, photos, anomalies)
//   - Sites favoris = fréquence cumulée, jamais "% complétion"
//   - Rythme 14j + heatmap 90j = densité visuelle, jamais "trop / pas assez"
//   - Compagnons = équipes voisines par lien factuel (membre/site partagé),
//     pas de scoring de proximité
//   - Spécialités = déclarations manager, jamais inférées
//
// Pas de wording évaluatif. Pas de comparaison inter-équipes (chaque page = 1
// équipe, pas de bouton « comparer »).

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Users,
  Calendar,
  ImageIcon,
  AlertTriangle,
  Building2,
  Briefcase,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  getTeamOverview,
  listTeamFavoriteSites,
  listTeamContractsCovered,
  getTeamRhythm14d,
  getTeamHeatmap90d,
  listTeamCompanions,
  listTeamRecentInterventions,
  listTeamRecentPhotos,
} from '@/lib/db/team-profile'
import { listMembersOfTeam } from '@/lib/db/teams'
import { TeamBadge } from '@/components/ui/team-badge'
import { SpecialtyBadge } from '@/components/ui/team-specialties'
import { TeamRhythm } from './TeamRhythm'
import { TeamHeatmap } from './TeamHeatmap'
import { TeamSpecialtiesSection } from './TeamSpecialtiesSection'
import { CreateTeamTakesSiteButton } from '@/app/(dashboard)/handovers/CreateTeamTakesSiteButton'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOrgCatalog } from '@/lib/db/org-catalog'

export const dynamic = 'force-dynamic'

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function fmtPlannedRange(start: string | null, end: string | null): string {
  if (!start) return ''
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (!end) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
  validated: 'Validée',
  skipped: 'Sautée',
}

const STATUS_BADGE: Record<string, string> = {
  planned: 'bg-sky-50 text-sky-800 border-sky-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  validated: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-medium',
  skipped: 'bg-muted text-muted-foreground border-border',
}

export default async function TeamProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await getCurrentUserWithProfile()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/m')

  const overview = await getTeamOverview(id)
  if (!overview) notFound()
  // P1 isolation : une équipe d'un autre tenant est invisible, même par id
  // direct — FAIL-CLOSED (viewer sans org ou org différente → 404).
  if (!me.organization_id || overview.organizationId !== me.organization_id) notFound()

  // Chargements parallèles
  const [
    favoriteSites,
    contractsCovered,
    rhythm,
    heatmap,
    companions,
    recentInterventions,
    recentPhotos,
    members,
    availableSites,
    specialtyCatalog,
  ] = await Promise.all([
    listTeamFavoriteSites(id, 8),
    listTeamContractsCovered(id),
    getTeamRhythm14d(id),
    getTeamHeatmap90d(id),
    listTeamCompanions(id),
    listTeamRecentInterventions(id, 15),
    listTeamRecentPhotos(id, 8),
    listMembersOfTeam(id),
    // Sprint Équipes C : pour le sélecteur de site dans le bouton « Prise de site »
    // P1 isolation : sites DU TENANT uniquement (la garde plus haut assure
    // me.organization_id non-null).
    (async () => {
      const admin = createAdminClient()
      const { data } = await admin
        .from('sites')
        .select('id, name, client:clients(name)')
        .is('deleted_at', null)
        .eq('organization_id', me.organization_id!)
        .order('name', { ascending: true })
      type Row = {
        id: string
        name: string
        client: { name: string } | { name: string }[] | null
      }
      return ((data ?? []) as Row[]).map((s) => {
        const client = Array.isArray(s.client) ? s.client[0] ?? null : s.client
        return { id: s.id, name: s.name, client_name: client?.name ?? null }
      })
    })(),
    // Vocabulaire métier de l'org : spécialités / corps d'état (catalogue → fallback template)
    listOrgCatalog(me.organization_id, 'team_specialty'),
  ])

  const specialtyOptions = specialtyCatalog.map((c) => ({ key: c.key, label: c.label }))

  const ageLabel = (() => {
    const days = overview.ageDays
    if (days < 30) return `${days} jour${days > 1 ? 's' : ''}`
    if (days < 365) {
      const months = Math.floor(days / 30)
      return `${months} mois`
    }
    const years = Math.floor(days / 365)
    const remMonths = Math.floor((days % 365) / 30)
    return remMonths > 0 ? `${years} an${years > 1 ? 's' : ''} et ${remMonths} mois` : `${years} an${years > 1 ? 's' : ''}`
  })()

  return (
    <div className="space-y-6 w-full">
      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/equipes" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Équipes
        </Link>
        <span>›</span>
        <span className="text-foreground font-medium">{overview.name}</span>
      </div>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <TeamBadge
            name={overview.name}
            color={overview.color}
            icon={overview.icon}
            size="md"
          />
          <span className="text-xs text-muted-foreground">
            · {overview.memberCount} personne{overview.memberCount > 1 ? 's' : ''}
            {overview.referent && (
              <>
                {' · Référent : '}
                <span className="text-foreground">
                  {displayName(overview.referent.full_name, overview.referent.email)}
                </span>
              </>
            )}
            {' · Créée il y a '}{ageLabel}
          </span>
        </div>

        {/* Spécialités (compact, lecture seule dans le header) */}
        {overview.specialties.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-600" aria-hidden />
            <span className="text-xs text-muted-foreground mr-1">Spécialités :</span>
            {overview.specialties.map((s) => (
              <SpecialtyBadge key={s} k={s} />
            ))}
          </div>
        )}

        {/* Compteurs inline */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t">
          <Counter
            icon={Building2}
            label="Chantiers couverts"
            value={overview.counters.sitesCovered}
          />
          <Counter
            icon={Briefcase}
            label="Contrats touchés"
            value={overview.counters.contractsCovered}
          />
          <Counter
            icon={Calendar}
            label="Interventions"
            value={overview.counters.interventionsDocumented}
          />
          <Counter
            icon={ImageIcon}
            label="Photos déposées"
            value={overview.counters.photosDeposited}
          />
          <Counter
            icon={AlertTriangle}
            label="Anomalies traitées"
            value={overview.counters.anomaliesHandled}
          />
        </div>
      </header>

      {/* ── Actions Sprint C : amorçage passage de témoin ────────────── */}
      <div className="flex flex-wrap gap-2">
        <CreateTeamTakesSiteButton
          teamId={overview.id}
          teamName={overview.name}
          availableSites={availableSites}
        />
      </div>

      {/* ── Spécialités (édition inline) ─────────────────────────────── */}
      <TeamSpecialtiesSection teamId={overview.id} initial={overview.specialties} options={specialtyOptions} />

      {/* ── Rythme 14j + Heatmap 90j ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border bg-card p-4 space-y-2">
          <h2 className="text-sm font-medium">Rythme — 14 derniers jours</h2>
          <p className="text-[11px] text-muted-foreground">
            Densité quotidienne d&apos;interventions de l&apos;équipe. Lecture descriptive.
          </p>
          <TeamRhythm days={rhythm} />
        </section>
        <section className="rounded-lg border bg-card p-4 space-y-2">
          <h2 className="text-sm font-medium">Densité — 90 derniers jours</h2>
          <p className="text-[11px] text-muted-foreground">
            Une case = un jour. Plus la teinte est dense, plus il y a eu d&apos;interventions ce jour-là.
          </p>
          <TeamHeatmap cells={heatmap} />
        </section>
      </div>

      {/* ── Sites favoris + Contrats touchés ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand-600" />
            Chantiers favoris
          </h2>
          {favoriteSites.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucun chantier couvert pour l&apos;instant.
            </p>
          ) : (
            <ul className="divide-y -my-2">
              {favoriteSites.map((s) => (
                <li key={s.site_id} className="py-2">
                  <Link
                    href={`/sites/${s.site_id}`}
                    className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.site_name}</p>
                      {s.contract_name && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {s.contract_name}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs tabular-nums">
                        {s.interventionCount} intervention{s.interventionCount > 1 ? 's' : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Dern. {fmtDateShort(s.lastInterventionDate)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-brand-600" />
            Contrats touchés
          </h2>
          {contractsCovered.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucun contrat encore.
            </p>
          ) : (
            <ul className="divide-y -my-2">
              {contractsCovered.slice(0, 8).map((c) => (
                <li key={c.contract_id} className="py-2">
                  <Link
                    href={`/contracts/${c.contract_id}`}
                    className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.contract_name}</p>
                      {c.client_name && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {c.client_name}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs tabular-nums">
                        {c.interventionCount}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Dern. {fmtDateShort(c.lastInterventionDate)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Galerie photos ───────────────────────────────────────────── */}
      {recentPhotos.length > 0 && (
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-brand-600" />
            Photos récentes
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {recentPhotos.map((p) => (
              <Link
                key={p.id}
                href={p.siteId ? `/sites/${p.siteId}` : '#'}
                className="aspect-square rounded-md overflow-hidden border bg-muted relative group"
                title={p.caption ?? p.siteName ?? ''}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.signedUrl}
                  alt={p.caption ?? p.siteName ?? 'Photo intervention'}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Compagnons + Membres actuels ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-600" />
            Équipes voisines
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Équipes qui partagent au moins un membre ou un chantier avec celle-ci.
            Utile pour les passages de témoin et le back-up.
          </p>
          {companions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Pas d&apos;équipe voisine pour l&apos;instant.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {companions.slice(0, 6).map((c) => (
                <li key={c.team_id}>
                  <Link
                    href={`/equipes/${c.team_id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                  >
                    <TeamBadge
                      name={c.team_name}
                      color={c.team_color}
                      icon={c.team_icon}
                      size="sm"
                    />
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {c.sharedActiveMembers > 0 && (
                        <>{c.sharedActiveMembers} membre{c.sharedActiveMembers > 1 ? 's' : ''}</>
                      )}
                      {c.sharedActiveMembers > 0 && c.sharedSites > 0 && ' · '}
                      {c.sharedSites > 0 && (
                        <>{c.sharedSites} chantier{c.sharedSites > 1 ? 's' : ''}</>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-600" />
            Composition actuelle
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Membres présents aujourd&apos;hui dans l&apos;équipe.
          </p>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucun membre — ajoute des chefs d&apos;équipe via la page Équipes.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {members.map((m) => {
                const name = displayName(m.user.full_name, m.user.email)
                const isRef = overview.referent?.id === m.user.id
                return (
                  <li key={m.user.id} className="flex items-center gap-2">
                    <span>{name}</span>
                    {isRef && (
                      <span className="text-[9px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-600/10">
                        Réf.
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ── Activité récente ─────────────────────────────────────────── */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Calendar className="h-4 w-4 text-brand-600" />
          Activité récente
        </h2>
        {recentInterventions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune intervention récente.
          </p>
        ) : (
          <ul className="divide-y -my-2">
            {recentInterventions.map((i) => {
              const planned = fmtPlannedRange(i.planned_start, i.planned_end)
              return (
                <li key={i.intervention_id} className="py-2">
                  <Link
                    href={`/sites/${i.site_id}`}
                    className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{i.mission_name}</span>
                        <span className="text-muted-foreground"> · {i.site_name}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDateShort(i.scheduled_for)}
                        {planned && ` · ${planned}`}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md border ${STATUS_BADGE[i.status] ?? 'bg-muted text-muted-foreground border-border'}`}
                    >
                      {STATUS_LABEL[i.status] ?? i.status}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Doctrine reminder discret, en pied de page */}
      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        Toutes les données affichées ici sont descriptives. Aucune comparaison
        inter-équipes, aucun classement, aucun score. L&apos;équipe est un conteneur
        logistique, jamais une unité d&apos;évaluation.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Compteur inline (réutilise le pattern de la fiche intervenant)
// ----------------------------------------------------------------------------

function Counter({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
