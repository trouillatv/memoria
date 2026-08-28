import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSiteAccess as requireFieldSiteAccess } from '@/lib/field/site-access'
import { TERRAIN_VISIT_ORIGINS } from '@/lib/field/visit-origins'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { SpontaneousCapturePanel } from './SpontaneousCapturePanel'
import { VisitLauncher } from './VisitLauncher'
import { VisitBasket, type SubjectMemoryLite } from './VisitBasket'
import { VisitObjectivePrompt } from './VisitObjectivePrompt'
import { getActiveVisit, getStartedVisitById, buildSiteStatusSummary, buildSinceLastVisitDelta } from '@/lib/db/visits'
import { getSiteCoverPhoto } from '@/lib/db/site-cover'
import { SiteStatusCard } from './SiteStatusCard'
import { SinceLastVisitCard } from './SinceLastVisitCard'
import { JustVisitedBanner } from './JustVisitedBanner'
import { SitePresenceReminders } from './SitePresenceReminders'
import { buildSitePresenceReminders } from '@/lib/db/site-presence'
import { listVisitCaptures, listSiteViewpointRows, getVisitCapturePreviewUrls } from '@/lib/db/visit-captures'
import { groupViewpointChains } from '@/lib/visits/viewpoints'
import { listWatchlist } from '@/lib/db/visit-watchlist'
import { getSiteNextSteps } from '@/lib/db/site-next-steps'
import { NextStepCard } from './NextStepCard'
import { buildVisitBrief } from '@/lib/db/site-visit-brief'
import { VisitBriefCard } from './VisitBriefCard'
import { listOpenSiteSubjectsLite, listSubjectsBySite } from '@/lib/db/subjects'
import { SiteReportLauncher } from './SiteReportLauncher'
import { DeliverFieldPanel } from './DeliverFieldPanel'
import { AddDocumentPanel } from './AddDocumentPanel'
import { QuickActionButton } from '@/components/actions/QuickActionButton'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import { ChefSiteView } from './ChefSiteView'
import { CopilotMobileSheet } from './CopilotMobileSheet'
import { ChevronRight } from 'lucide-react'
import { Suspense } from 'react'
import { SiteToTreatSection, SiteToTreatSkeleton } from './SiteToTreatSection'

const INTV_STATUS_META: Record<string, { label: string; cls: string }> = {
  planned: { label: 'Prévue', cls: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'En cours', cls: 'bg-sky-100 text-sky-700' },
  completed: { label: 'Terminée', cls: 'bg-emerald-100 text-emerald-700' },
  validated: { label: 'Validée', cls: 'bg-emerald-100 text-emerald-700' },
}

/**
 * V5.1 Slice 1 — Page de dépôt photo libre sur un site (hors workflow
 * intervention pré-planifiée).
 *
 * Joseph arrive sur un site. Il ouvre cette page (via FAB sur /m ou QR/lien
 * direct). Il voit : son prénom, le nom du site, son Nᵉ passage, la dernière
 * trace notable. Bouton photo 80px sticky en bas. Après prise photo, choix
 * Passage / Anomalie. Trace déposée en queue IndexedDB, sync silencieuse.
 *
 * Grammaire sensorielle V5.1 :
 *   - Pas de checklist, pas de mission du jour, pas de "Bon courage"
 *   - 1 idée principale : déposer une trace
 *   - Phrase de mémoire en italique grisée, JAMAIS comme injonction
 *   - Aucun chiffre saillant (le "47ᵉ passage" est une signature, pas un KPI)
 */

// V5.1 — Helper local pour Nᵉ passage. Pas un KPI, pas exposé en agrégat
// global, juste affichage du compteur personnel sur ce site.
// Source : site_reports créés par cet utilisateur (même source que buildSinceLastVisitDelta)
// pour éviter la contradiction « 1e passage » / « dernier passage il y a 7j ».
async function countDistinctVisitDays(userId: string, siteId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_reports')
    .select('ended_at')
    .eq('site_id', siteId)
    .eq('created_by', userId)
    .in('origin', TERRAIN_VISIT_ORIGINS)
    .not('ended_at', 'is', null)
    .is('deleted_at', null)
  const distinctDays = new Set(
    (data ?? []).map((r) => (r as { ended_at: string }).ended_at.slice(0, 10))
  )
  return distinctDays.size
}

function firstNameOf(fullName: string | null, email: string): string {
  const trimmed = (fullName ?? '').trim()
  if (trimmed.length > 0) {
    const first = trimmed.split(/\s+/)[0]
    if (first) return first
  }
  const local = (email.split('@')[0] ?? email).trim()
  if (local.length === 0) return ''
  return local[0].toUpperCase() + local.slice(1)
}

export default async function FieldSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ visite?: string; live?: string; reprendre?: string }>
}) {
  const { siteId } = await params
  const sp = await searchParams
  const justVisited = sp.visite === 'ok'
  // Reprise d'une réunion en attente (`?reprendre=` depuis la carte du Journal) :
  // le panneau compte-rendu s'ouvre directement sur la réunion existante.
  const resumeReportId = typeof sp.reprendre === 'string' && sp.reprendre.length > 0 ? sp.reprendre : null
  // Visite tout juste démarrée : son id est porté dans l'URL (`?live=`). On l'ouvre
  // DIRECTEMENT en panier, sans attendre que la relecture `getActiveVisit` reflète
  // l'insert — le « swap » fiche → panier devient déterministe (cf. getStartedVisitById).
  const liveVisitId = typeof sp.live === 'string' && sp.live.length > 0 ? sp.live : null
  // Un chantier d'une autre organisation doit être indiscernable d'un chantier
  // inexistant : la garde rend 404, jamais « accès refusé ».
  const { user } = await requireFieldSiteAccess(siteId)

  // FRONTIÈRE D'ORGANISATION, SANS EXEMPTION DE RÔLE (M2B). `requireFieldSiteAccess`
  // ci-dessus passe par `requireOwned`, qui exempte l'admin plateforme — et le
  // mobile lit `sites` en direct juste après. La façade M2B `requireSiteAccess`
  // n'exempte aucun rôle : l'accès métier exige une appartenance, ici comme au
  // bureau. Elle rend `notFound()` sur refus, `redirect('/login')` si la session
  // manque.
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  // Chef d'équipe (exécutant) : fiche chantier TERRAIN dédiée — JAMAIS le cockpit
  // conducteur NI le flux de visite (acte de pilotage). Court-circuit AVANT toute
  // la machinerie de visite et les fetchs lourds : le chef n'en charge et n'en
  // voit rien, même si une visite est active sur le site (démarrée par un
  // conducteur). Doctrine Vincent 2026-07-29 — « le conducteur organise, le chef exécute ».
  if (user.role === 'chef_equipe') {
    return <ChefSiteView siteId={siteId} userId={user.id} userRole={user.role} />
  }

  const pastVisitDays = await countDistinctVisitDays(user.id, siteId)
  const nthPassage = pastVisitDays + 1

  // Visite en cours — chargée en priorité.
  const activeVisitFromQuery = await getActiveVisit(siteId).catch(() => null)
  // Repli déterministe : si la relecture n'a pas (encore) retrouvé la visite mais
  // que l'URL porte l'id d'une visite qu'on vient de démarrer, on l'ouvre par id.
  const activeVisit =
    activeVisitFromQuery ??
    (liveVisitId ? await getStartedVisitById(liveVisitId, siteId).catch(() => null) : null)

  // PERF — hors visite en cours, TOUTES les données de cockpit sont
  // indépendantes : un seul aller-retour parallèle au lieu d'une chaîne
  // séquentielle (la fiche est la page la plus ouverte : elle doit être rapide).
  let siteStatus: Awaited<ReturnType<typeof buildSiteStatusSummary>> = []
  let sinceLastVisit: Awaited<ReturnType<typeof buildSinceLastVisitDelta>> = null
  let nextSteps: Awaited<ReturnType<typeof getSiteNextSteps>> = []
  let visitBrief: Awaited<ReturnType<typeof buildVisitBrief>> = null
  if (!activeVisit) {
    const [status, since, steps, brief] = await Promise.all([
      buildSiteStatusSummary(siteId).catch(() => []),
      buildSinceLastVisitDelta(siteId, user.id).catch(() => null),
      getSiteNextSteps(siteId).catch(() => []),
      buildVisitBrief(siteId).catch(() => null),
    ])
    siteStatus = status
    sinceLastVisit = since
    nextSteps = steps
    visitBrief = brief
  }
  // Panier terrain : si une visite est ouverte, on charge ses captures + les points
  // suivis (pour le geste « Vérifier un point »).
  let visitSubjects: Awaited<ReturnType<typeof listOpenSiteSubjectsLite>> = []
  let visitCaptures: Awaited<ReturnType<typeof listVisitCaptures>> = []
  // Mémoire LITE par sujet (read-only) — surfacée au moment où on vérifie un point :
  // « voilà ce qu'on sait déjà dessus ». Une seule requête (listSubjectsBySite).
  const subjectMemory: Record<string, SubjectMemoryLite> = {}
  // Points de repère (mig 195) : séries « même cadrage » du chantier, avec l'URL
  // signée de la DERNIÈRE photo de chaque série (le fantôme de la reprise).
  let visitViewpoints: Array<{ anchorId: string; label: string | null; lastUrl: string | null; shots: number }> = []
  let visitWatchlist: Awaited<ReturnType<typeof listWatchlist>> = []
  if (activeVisit) {
    const [subs, caps, summaries, vpRows, watch] = await Promise.all([
      listOpenSiteSubjectsLite(siteId).catch(() => []),
      listVisitCaptures(activeVisit.id).catch(() => []),
      listSubjectsBySite(siteId).catch(() => []),
      listSiteViewpointRows(siteId).catch(() => []),
      listWatchlist(activeVisit.id).catch(() => []),
    ])
    visitWatchlist = watch
    visitSubjects = subs
    visitCaptures = caps
    const chains = groupViewpointChains(vpRows)
    if (chains.length > 0) {
      const lastPreviews = await getVisitCapturePreviewUrls(chains.map((c) => c.last))
        .catch(() => ({} as Record<string, { url: string; mime: string | null }>))
      visitViewpoints = chains.map((c) => ({
        anchorId: c.anchorId,
        label: c.label,
        lastUrl: lastPreviews[c.last.id]?.url ?? null,
        shots: c.shots,
      }))
    }
    for (const s of summaries) {
      subjectMemory[s.id] = {
        // Âge calculé côté serveur (évite Date.now() en rendu client).
        lastActivityDays: s.lastActivity
          ? Math.max(0, Math.round((Date.now() - new Date(s.lastActivity).getTime()) / 86_400_000))
          : null,
        openReserves: s.openReserves,
        openActions: s.openActions,
        lateActions: s.lateActions,
        decisions: s.decisions,
        criticality: s.criticality,
      }
    }
  }

  // « Aujourd'hui ici » — page d'arrivée terrain. On s'assure des récurrences du
  // jour, puis on agrège interventions du jour. Réponse immédiate à « qu'est-ce
  // qui me concerne ici, maintenant ? ».
  const todayIso = todayLocalIso()
  await ensureTodayInterventionsForSites([siteId], 0).catch(() => {})
  const { data: siteMissionRows } = await supabase
    .from('missions').select('id, name').eq('site_id', siteId).is('deleted_at', null)
  const missionNameById = new Map((siteMissionRows ?? []).map((m) => [m.id as string, m.name as string]))
  const siteMissionIds = [...missionNameById.keys()]
  type TodayIntv = { id: string; status: string; slot: 'morning' | 'afternoon' | 'evening' | null; planned_start: string | null; planned_end: string | null; mission_id: string; label: string | null }
  const todayInterventions: TodayIntv[] = siteMissionIds.length === 0
    ? []
    : (((await supabase
        .from('interventions')
        .select('id, status, slot, planned_start, planned_end, mission_id, label')
        .in('mission_id', siteMissionIds)
        .eq('scheduled_for', todayIso)
        .neq('status', 'skipped')
        .order('planned_start', { ascending: true })).data) ?? []) as TodayIntv[]

  const presenceReminders = await buildSitePresenceReminders(siteId, { limit: 3 }).catch(() => [])

  // Photo principale du chantier (mig 243) — la vignette qui le représente.
  // Pas pendant une visite en cours : l'écran de collecte reste épuré.
  const cover = activeVisit ? null : await getSiteCoverPhoto(siteId).catch(() => null)

  return (
    <div className="max-w-md space-y-6 pb-32">
      {justVisited && <JustVisitedBanner />}
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          Bonjour {firstNameOf(user.full_name, user.email)}
        </h1>
      </header>

      <section className="space-y-2">
        {cover && (
          <div className="overflow-hidden rounded-2xl border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover.url} alt={`Photo du chantier ${site.name}`} className="h-40 w-full object-cover" />
          </div>
        )}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold leading-tight">{site.name}</h2>
          <p className="text-sm text-muted-foreground">{nthPassage}ᵉ passage</p>
        </div>
      </section>

      {/* Visite ouverte → le PANIER (collecte focalisée, écran épuré). Sinon → la
          fiche « dossier vivant » : on COMPREND le chantier, on SE PRÉPARE, on AGIT. */}
      {activeVisit ? (
        <div className="space-y-3">
          {/* Rappel discret propre à l'intention « Première visite » : on crée le
              point de départ du chantier (différenciation légère, même moteur). */}
          {activeVisit.visit_motive === 'premiere' && (
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
              Vous créez le point de départ de ce chantier.
            </p>
          )}
          {/* Objet au démarrage — MemorIA sait dès le début pourquoi on est là. */}
          {!activeVisit.objective && (
            <VisitObjectivePrompt reportId={activeVisit.id} siteId={siteId} />
          )}
          <VisitBasket
            reportId={activeVisit.id}
            siteId={siteId}
            siteName={site.name}
            userId={user.id}
            startedAt={activeVisit.started_at}
            subjects={visitSubjects}
            subjectMemory={subjectMemory}
            initialCaptures={visitCaptures}
            viewpoints={visitViewpoints}
            watchlist={visitWatchlist}
            mapboxToken={process.env.MAPBOX_TOKEN ?? null}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1 — État du chantier */}
          <SiteStatusCard cells={siteStatus} />

          {/* 2 — À traiter : signaux d'intervention uniquement (propositions + actions en retard + sujet urgent). */}
          <Suspense fallback={<SiteToTreatSkeleton />}>
            <SiteToTreatSection siteId={siteId} />
          </Suspense>

          {/* 3 — Sur place : opportunités contextuelles + agenda du jour.
              VisitBriefCard répond à « qu'est-ce qui vaut le coup de traiter si je suis là ? »
              Les interventions répondent à « qu'est-ce qui est planifié ici aujourd'hui ? »
              Silence si aucun des deux n'a de contenu. */}
          {(visitBrief || todayInterventions.length > 0 || presenceReminders.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sur place</h2>
              {visitBrief && <VisitBriefCard brief={visitBrief} siteId={siteId} />}
              {presenceReminders.length > 0 && <SitePresenceReminders reminders={presenceReminders} />}
              {todayInterventions.length > 0 && (
                <ul className="space-y-1.5">
                  {todayInterventions.map((i) => {
                    const meta = INTV_STATUS_META[i.status] ?? INTV_STATUS_META.planned
                    const time = formatInterventionTimeLabel({ planned_start: i.planned_start, planned_end: i.planned_end, slot: i.slot })
                    return (
                      <li key={i.id}>
                        <Link
                          href={`/m/intervention/${i.id}`}
                          className="flex items-center gap-2 rounded-xl border bg-muted/30 shadow-sm px-3 py-2.5 active:brightness-95 transition"
                        >
                          <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0 w-12">{time}</span>
                          <span className="text-sm font-medium min-w-0 flex-1 truncate">{i.label ?? missionNameById.get(i.mission_id) ?? 'Intervention'}</span>
                          <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {/* 4 — Depuis votre dernier passage : ce qui vient de se passer. */}
          {sinceLastVisit && <SinceLastVisitCard delta={sinceLastVisit} siteId={siteId} />}

          {/* 5 — Prochaine étape : agenda à venir (réunions, interventions, échéances). */}
          <NextStepCard steps={nextSteps} />

          {/* ─── Zone d'action ─── */}
          <section className="space-y-2.5">
            <SiteBriefButton siteId={siteId} variant="mobile" mode="visit" />
            <SiteBriefButton siteId={siteId} variant="mobile" mode="meeting" />
          </section>

          <Link
            href={`/m/site/${siteId}/visites`}
            className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm active:brightness-95"
          >
            <div>
              <p className="text-[14px] font-medium">Explorer le chantier</p>
              <p className="text-[12px] text-muted-foreground">Visites · Réunions · Actions · Réserves · Mémoire · Documents</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          {/* Demander à MemorIA — compact et secondaire. */}
          <CopilotMobileSheet siteId={siteId} siteName={site.name} />

          {/* Ajouter… — outils de création du lieu. */}
          <section className="space-y-2 pt-3 border-t border-border/40">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ajouter…
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <QuickActionButton source="mobile_site" siteId={siteId} variant="mobile" />
              <SpontaneousCapturePanel siteId={siteId} siteName={site.name} />
              <SiteReportLauncher siteId={siteId} siteName={site.name} variant="mobile" label="Compte-rendu" resumeReportId={resumeReportId} />
              <DeliverFieldPanel siteId={siteId} />
              <AddDocumentPanel siteId={siteId} />
            </div>
          </section>

          {/* Démarrer la visite — sticky. */}
          <div className="sticky bottom-20 z-30 drop-shadow-lg">
            <VisitLauncher siteId={siteId} activeVisit={null} />
          </div>
        </div>
      )}
    </div>
  )
}
