import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSiteAccess as requireFieldSiteAccess } from '@/lib/field/site-access'
import { TERRAIN_VISIT_ORIGINS } from '@/lib/field/visit-origins'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { VisitLauncher } from './VisitLauncher'
import { VisitBasket, type SubjectMemoryLite } from './VisitBasket'
import { VisitObjectivePrompt } from './VisitObjectivePrompt'
import { getActiveVisit, getStartedVisitById, buildSiteStatusSummary, buildSinceLastVisitDelta } from '@/lib/db/visits'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { SiteHeroMobile } from './SiteHeroMobile'
import { SiteKpiTiles } from './SiteKpiTiles'
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
import { listVerifyEligiblePointsForSite } from '@/lib/knowledge/tracked-point-verify-eligibility'
import { SiteActionBar } from './SiteActionBar'
import { ChefSiteView } from './ChefSiteView'
import { loadMemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { selectLingeringPoints, loadSitePvDates, loadOpenActionCountBySubject } from '@/lib/knowledge/tracked-point-lingering'
import { computeSiteTodaySynthesis } from '@/lib/knowledge/site-today-synthesis'
import { buildActivitySinceLastPv } from '@/lib/knowledge/site-activity'
import { SiteTodaySynthesisLine } from '@/components/site/SiteTodaySynthesisLine'
import { SiteTodayAttentionList } from '@/components/site/SiteTodayAttentionList'
import { MemoriaNeedsYouBlock } from '@/components/site/MemoriaNeedsYouBlock'
import { SiteLingeringPointsBlock } from '@/components/site/SiteLingeringPointsBlock'
import { SincePvActivityBlock } from '@/components/site/SincePvActivityBlock'
import { ChevronRight } from 'lucide-react'

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

  // Identité (logo client, nom client) + compteur de passage terrain + visite en
  // cours : trois lectures indépendantes → un seul aller-retour parallèle.
  const [pastVisitDays, identity, activeVisitFromQuery] = await Promise.all([
    countDistinctVisitDays(user.id, siteId),
    getSiteIdentity(siteId).catch(() => null),
    getActiveVisit(siteId).catch(() => null),
  ])
  const nthPassage = pastVisitDays + 1
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
  // Lot 2 « Aujourd'hui » (mandat Vincent) — mêmes moteurs gelés que l'onglet desktop
  // (deriveCanonicalAttentionItems, loadTrackedPointReadModel, loadMemoriaNeedsYouSummary),
  // chargés uniquement hors visite active comme le reste du cockpit chantier ci-dessus.
  let needsYouSummary: Awaited<ReturnType<typeof loadMemoriaNeedsYouSummary>> | null = null
  let attentionItems: Awaited<ReturnType<typeof deriveCanonicalAttentionItems>> = []
  let pointModel: Awaited<ReturnType<typeof loadTrackedPointReadModel>> = { points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] }
  let pvDates: Awaited<ReturnType<typeof loadSitePvDates>> = []
  let openActionCountBySubject: Awaited<ReturnType<typeof loadOpenActionCountBySubject>> = new Map()
  let pvActivity: Awaited<ReturnType<typeof buildActivitySinceLastPv>> = null
  if (!activeVisit) {
    const [status, since, steps, brief, needsYou, attention, points, pvs, openActionCounts, activity] = await Promise.all([
      buildSiteStatusSummary(siteId).catch(() => []),
      buildSinceLastVisitDelta(siteId, user.id).catch(() => null),
      getSiteNextSteps(siteId).catch(() => []),
      buildVisitBrief(siteId).catch(() => null),
      loadMemoriaNeedsYouSummary(siteId).catch(() => null),
      deriveCanonicalAttentionItems(siteId).catch(() => []),
      loadTrackedPointReadModel(siteId).catch(() => ({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] })),
      loadSitePvDates(siteId).catch(() => []),
      loadOpenActionCountBySubject(siteId).catch(() => new Map<string, number>()),
      buildActivitySinceLastPv(siteId).catch(() => null),
    ])
    siteStatus = status
    sinceLastVisit = since
    nextSteps = steps
    visitBrief = brief
    needsYouSummary = needsYou
    attentionItems = attention
    pointModel = points
    pvDates = pvs
    openActionCountBySubject = openActionCounts
    pvActivity = activity
  }
  // Panier terrain : si une visite est ouverte, on charge ses captures + les points
  // suivis (pour le geste « Vérifier un point »).
  let visitSubjects: Awaited<ReturnType<typeof listOpenSiteSubjectsLite>> = []
  // Points suivis éligibles à une vérification terrain (mig 397, Policy 4) — même
  // panier que les sujets legacy, cf. lib/knowledge/tracked-point-verify-eligibility.ts.
  let visitTrackedPoints: Awaited<ReturnType<typeof listVerifyEligiblePointsForSite>> = []
  let visitCaptures: Awaited<ReturnType<typeof listVisitCaptures>> = []
  // Mémoire LITE par sujet (read-only) — surfacée au moment où on vérifie un point :
  // « voilà ce qu'on sait déjà dessus ». Une seule requête (listSubjectsBySite).
  const subjectMemory: Record<string, SubjectMemoryLite> = {}
  // Points de repère (mig 195) : séries « même cadrage » du chantier, avec l'URL
  // signée de la DERNIÈRE photo de chaque série (le fantôme de la reprise).
  let visitViewpoints: Array<{ anchorId: string; label: string | null; lastUrl: string | null; shots: number }> = []
  let visitWatchlist: Awaited<ReturnType<typeof listWatchlist>> = []
  if (activeVisit) {
    const [subs, points, caps, summaries, vpRows, watch] = await Promise.all([
      listOpenSiteSubjectsLite(siteId).catch(() => []),
      listVerifyEligiblePointsForSite(siteId).catch(() => []),
      listVisitCaptures(activeVisit.id).catch(() => []),
      listSubjectsBySite(siteId).catch(() => []),
      listSiteViewpointRows(siteId).catch(() => []),
      listWatchlist(activeVisit.id).catch(() => []),
    ])
    visitWatchlist = watch
    visitSubjects = subs
    visitTrackedPoints = points
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
  const lingering = selectLingeringPoints(pointModel.points, todayIso, pvDates, { attentionItems, openActionCountBySubject })
  const todaySynthesis = computeSiteTodaySynthesis(pointModel.points, needsYouSummary?.totalCount ?? 0, todayIso)
  const pointHrefPrefix = `/m/site/${siteId}/point`
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

  return (
    <div className="max-w-md space-y-6 pb-32">
      {justVisited && <JustVisitedBanner />}

      {/* Hero chantier compact — identité MemorIA à l'entrée d'un chantier :
          logo client prioritaire (sinon présence MemorIA), nom du chantier,
          badge de passage terrain. Remplace l'ancien en-tête + la photo de
          couverture (abandonnée en Phase 1 : le logo client porte l'identité). */}
      <SiteHeroMobile
        siteName={site.name}
        clientName={identity?.clientName ?? null}
        clientLogoUrl={identity?.clientLogoUrl ?? null}
        nthPassage={nthPassage}
        greetingName={firstNameOf(user.full_name, user.email)}
      />

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
            trackedPoints={visitTrackedPoints}
            subjectMemory={subjectMemory}
            initialCaptures={visitCaptures}
            viewpoints={visitViewpoints}
            watchlist={visitWatchlist}
            mapboxToken={process.env.MAPBOX_TOKEN ?? null}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 0 — Synthèse chantier : LOT 2.1 (mandat Vincent 2026-09-10), une ligne compacte
              réutilisant uniquement des métriques déjà calculées (computeSiteTodaySynthesis,
              même moteur que le desktop). Jamais un nouveau tableau de bord. */}
          <SiteTodaySynthesisLine synthesis={todaySynthesis} />

          {/* 1 — État du chantier : 4 mini-KPI sur une ligne (même vérité, compact),
              puis la TOOLBAR du chantier collée dessous. L'ordre porte la lecture :
              je comprends le chantier → j'ai mes outils → je lis ce qui mérite mon
              attention. La barre n'est pas une section du contenu : elle ne descend
              donc jamais sous « À traiter » / « Sur place » / l'agenda. */}
          <div className="space-y-2.5">
            <SiteKpiTiles cells={siteStatus} />
            <SiteActionBar siteId={siteId} siteName={site.name} resumeReportId={resumeReportId} />
          </div>

          {/* 1bis — MemorIA a besoin de toi : signal d'attention discret, jamais un bloc
              principal. Après « État du chantier », avant « À surveiller » (mandat Vincent
              2026-09-07) — le parcours mental est : comment va mon chantier ? MemorIA a-t-il
              besoin de moi pour comprendre quelque chose ? qu'est-ce qui mérite mon attention ?
              Lot 2 « Aujourd'hui » : même bloc partagé que le desktop (loadMemoriaNeedsYouSummary). */}
          {needsYouSummary && (
            <MemoriaNeedsYouBlock summary={needsYouSummary} seeAllHref={`/m/site/${siteId}/besoin-de-toi`} />
          )}

          {/* 2 — À surveiller : Lot 2 « Aujourd'hui », même moteur gelé que le desktop
              (deriveCanonicalAttentionItems) — remplace l'ancien « À traiter ». */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              À surveiller
            </h2>
            <p className="text-xs text-muted-foreground">Risques ou sujets qui demandent attention maintenant</p>
            <SiteTodayAttentionList
              items={attentionItems}
              bySubject={pointModel.bySubject}
              cap={3}
              seeAllHref={`/m/site/${siteId}/sujets`}
              pointHrefPrefix={pointHrefPrefix}
              subjectHrefPrefix={`/m/site/${siteId}/sujets`}
            />
          </section>

          {/* 2ter — Depuis le dernier PV : LOT 2.1 (mandat Vincent 2026-09-10), réintégration
              d'un bloc de l'ancien Aperçu — réouverts / réapparus / résolus depuis le dernier PV,
              même moteur que le desktop (buildActivitySinceLastPv), aucune logique recréée. */}
          {pvActivity && <SincePvActivityBlock activity={pvActivity} />}

          {/* 2bis — Points qui traînent : Lot 2 « Aujourd'hui », lecture pure du read-model
              Points (Lot 1), aucun nouveau moteur. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Points qui traînent
            </h2>
            <p className="text-xs text-muted-foreground">Situations ouvertes qui stagnent malgré l&apos;activité du chantier</p>
            <SiteLingeringPointsBlock
              entries={lingering}
              seeAllHref={`/m/site/${siteId}/points`}
              pointHrefPrefix={pointHrefPrefix}
            />
          </section>

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

          {/* Démarrer la visite — sticky. */}
          <div className="sticky bottom-20 z-30 drop-shadow-lg">
            <VisitLauncher siteId={siteId} activeVisit={null} />
          </div>
        </div>
      )}
    </div>
  )
}
