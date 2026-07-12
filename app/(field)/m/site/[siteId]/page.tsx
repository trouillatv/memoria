import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteResumeContext } from '@/lib/db/interventions'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSiteReadings,
  getSiteHumanContinuity,
  getSiteTransmissionReadings,
  getSiteAnomalies,
  getSiteRecentPhotos,
} from '@/lib/db/site-cockpit'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { MobileSiteReadings } from '@/components/field/MobileSiteReadings'
import { SpontaneousCapturePanel } from './SpontaneousCapturePanel'
import { VisitLauncher } from './VisitLauncher'
import { VisitBasket, type SubjectMemoryLite } from './VisitBasket'
import { VisitObjectivePrompt } from './VisitObjectivePrompt'
import { getActiveVisit, getStartedVisitById, buildSiteStatusSummary, getSiteRecentActivity, buildSinceLastVisitSummary, getSiteMemorySnapshot } from '@/lib/db/visits'
import { getSiteIdentity } from '@/lib/db/sites'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { SiteStatusCard } from './SiteStatusCard'
import { IdentityCard } from './IdentityCard'
import { SiteTodoCard } from './SiteTodoCard'
import { SiteActivityCard } from './SiteActivityCard'
import { SiteQuickAccessCard } from './SiteQuickAccessCard'
import { SinceLastVisitCard } from './SinceLastVisitCard'
import { SiteMemoryCard } from './SiteMemoryCard'
import { JustVisitedBanner } from './JustVisitedBanner'
import { SitePresenceReminders } from './SitePresenceReminders'
import { buildSitePresenceReminders } from '@/lib/db/site-presence'
import { listVisitCaptures, listSiteViewpointRows, getVisitCapturePreviewUrls } from '@/lib/db/visit-captures'
import { groupViewpointChains } from '@/lib/visits/viewpoints'
import { listWatchlist } from '@/lib/db/visit-watchlist'
import { getSiteNextSteps } from '@/lib/db/site-next-steps'
import { NextStepCard } from './NextStepCard'
import { listOpenSiteSubjectsLite, listSubjectsBySite } from '@/lib/db/subjects'
import { SiteReportLauncher } from './SiteReportLauncher'
import { DeliverFieldPanel } from './DeliverFieldPanel'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { QuickActionButton } from '@/components/actions/QuickActionButton'
import { SiteMemoryQuery } from '@/app/(dashboard)/sites/[id]/SiteMemoryQuery'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import { ListTodo, Hammer, AlertTriangle, ChevronRight, Camera, Search } from 'lucide-react'
import { TogglePanel } from '@/app/(dashboard)/sites/[id]/TogglePanel'

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
async function countDistinctVisitDays(userId: string, siteId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return 0

  const { data: interventionsOfSite } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsOfSite ?? []).map((i) => i.id)
  if (interventionIds.length === 0) return 0

  const { data: photos } = await supabase
    .from('intervention_photos')
    .select('taken_at')
    .eq('taken_by', userId)
    .in('intervention_id', interventionIds)
  const distinctDays = new Set((photos ?? []).map((p) => p.taken_at.slice(0, 10)))
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

function formatTraceDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
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
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [pastVisitDays, resume, siteReadings, siteContinuity] = await Promise.all([
    countDistinctVisitDays(user.id, siteId),
    getSiteResumeContext(siteId, user.id),
    getSiteReadings(siteId),
    getSiteHumanContinuity(siteId),
  ])
  const nthPassage = pastVisitDays + 1

  // Actions ouvertes + visite en cours — indépendants, en parallèle.
  const [openActions, activeVisitFromQuery] = await Promise.all([
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    getActiveVisit(siteId).catch(() => null),
  ])
  // Repli déterministe : si la relecture n'a pas (encore) retrouvé la visite mais
  // que l'URL porte l'id d'une visite qu'on vient de démarrer, on l'ouvre par id.
  const activeVisit =
    activeVisitFromQuery ??
    (liveVisitId ? await getStartedVisitById(liveVisitId, siteId).catch(() => null) : null)

  // PERF — hors visite en cours, TOUTES les données de cockpit sont
  // indépendantes : un seul aller-retour parallèle au lieu d'une chaîne
  // séquentielle (la fiche est la page la plus ouverte : elle doit être rapide).
  const canSeeDocs = !activeVisit && (user.role === 'admin' || user.role === 'manager')
  let siteStatus: Awaited<ReturnType<typeof buildSiteStatusSummary>> = []
  let identity: Awaited<ReturnType<typeof getSiteIdentity>> = null
  let openReserves: { id: string; label: string; location: string | null }[] = []
  let recentActivity: Awaited<ReturnType<typeof getSiteRecentActivity>> = []
  let sinceLastVisit: Awaited<ReturnType<typeof buildSinceLastVisitSummary>> = null
  let memorySnapshot: Awaited<ReturnType<typeof getSiteMemorySnapshot>> | null = null
  let siteDocCount = 0
  let hasEvolution = false
  let nextSteps: Awaited<ReturnType<typeof getSiteNextSteps>> = []
  if (!activeVisit) {
    const [status, id, reservesRaw, activity, since, snapshot, docList, vpRows, steps] = await Promise.all([
      buildSiteStatusSummary(siteId).catch(() => []),
      getSiteIdentity(siteId).catch(() => null),
      getSiteReserves(siteId).catch(() => []),
      getSiteRecentActivity(siteId).catch(() => []),
      buildSinceLastVisitSummary(siteId, user.id).catch(() => null),
      getSiteMemorySnapshot(siteId).catch(() => null),
      canSeeDocs ? listDocumentsForTarget('site', siteId).catch(() => []) : Promise.resolve([]),
      listSiteViewpointRows(siteId).catch(() => []),
      getSiteNextSteps(siteId).catch(() => []),
    ])
    siteStatus = status
    identity = id
    openReserves = reservesRaw
      .filter((r) => r.status === 'open')
      .map((r) => ({ id: r.id, label: r.label, location: r.location }))
    recentActivity = activity
    sinceLastVisit = since
    memorySnapshot = snapshot
    siteDocCount = docList.length
    hasEvolution = groupViewpointChains(vpRows).length > 0
    nextSteps = steps
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
  // jour, puis on agrège interventions du jour + anomalies ouvertes + dernières
  // preuves. Réponse immédiate à « qu'est-ce qui me concerne ici, maintenant ? ».
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
  const [siteAnomalies, recentPhotos, aSavoir, presenceReminders] = await Promise.all([
    getSiteAnomalies(siteId).catch(() => []),
    getSiteRecentPhotos(siteId, 6).catch(() => []),
    listSiteASavoirActive(siteId).catch(() => []),
    // « Puisque vous êtes ici » — l'assistant de présence (niveau 3) : 1 à 3
    // opportunités à saisir sur place, déterministes, zéro donnée nouvelle.
    buildSitePresenceReminders(siteId, { limit: 3 }).catch(() => []),
  ])
  const openAnomalies = siteAnomalies.filter((a) => a.status === 'open')
  const openAnomaliesCount = openAnomalies.length

  // V5.1.4 — Mémoire IA périphérique (Vincent 2026-05-15)
  const siteTransmissions = await getSiteTransmissionReadings(siteId, siteContinuity)
  const enrichedSiteReadings = {
    readings: [...siteTransmissions, ...siteReadings.readings],
  }

  // Dernière trace notable : on prend la plus récente entre la première
  // anomalie et la première site_note (qui sont déjà triées DESC par
  // getSiteResumeContext).
  const lastAnomaly = resume.recentAnomalies[0]
  const lastNote = resume.recentSiteNotes[0]
  let lastNotable: { date: string; text: string } | null = null
  if (lastAnomaly && lastNote) {
    if (new Date(lastAnomaly.created_at) >= new Date(lastNote.created_at)) {
      lastNotable = { date: lastAnomaly.created_at, text: lastAnomaly.description }
    } else {
      lastNotable = { date: lastNote.created_at, text: lastNote.body }
    }
  } else if (lastAnomaly) {
    lastNotable = { date: lastAnomaly.created_at, text: lastAnomaly.description }
  } else if (lastNote) {
    lastNotable = { date: lastNote.created_at, text: lastNote.body }
  }

  return (
    <div className="max-w-md space-y-6 pb-32">
      {justVisited && <JustVisitedBanner />}
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          Bonjour {firstNameOf(user.full_name, user.email)}
        </h1>
      </header>

      <section className="space-y-1">
        <h2 className="text-2xl font-bold leading-tight">{site.name}</h2>
        <p className="text-sm text-muted-foreground">{nthPassage}ᵉ passage</p>
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
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1 — État du chantier : la santé en un coup d'œil (chiffres cliquables). */}
          <SiteStatusCard cells={siteStatus} />

          {/* 1bis — AGENDA DU CHANTIER : « comment va vivre ce chantier ces
              prochains jours ? » Réunions / interventions / échéances — la plus
              proche en grand, puis les jours nommés (Aujourd'hui / Demain / …).
              Silence positif si rien à venir. */}
          <NextStepCard steps={nextSteps} />

          {/* Attention — vigilances persistantes + anomalies (alerte à l'arrivée). */}
          {(aSavoir.length > 0 || openAnomalies.length > 0) && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Attention
              </h2>
              <ul className="space-y-1.5">
                {aSavoir.slice(0, 4).map((n) => (
                  <li key={n.id} className="text-sm text-amber-900 flex gap-1.5">
                    <span aria-hidden>⚠</span>
                    <span className="min-w-0">{n.body}</span>
                  </li>
                ))}
                {openAnomalies.slice(0, 3).map((a) => (
                  <li key={a.id} className="text-sm text-amber-900 flex gap-1.5">
                    <span aria-hidden>⚠</span>
                    <span className="min-w-0">{a.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 2 — Depuis votre dernière visite : ce qui a bougé (déterministe). */}
          {sinceLastVisit && <SinceLastVisitCard summary={sinceLastVisit} siteId={siteId} />}

          {/* 3 — Que reste-t-il à faire : les actions ouvertes / en retard. */}
          <SiteTodoCard actions={openActions} reserves={openReserves} todayIso={todayIso} totalActions={openActions.length} siteId={siteId} />

          {/* 4 — Dernière activité : ce qui s'est passé récemment, regroupé. */}
          <SiteActivityCard items={recentActivity} />

          {/* Mémoire — le cumul depuis la création : le chantier « parle ». */}
          {memorySnapshot && <SiteMemoryCard snapshot={memorySnapshot} />}

          {/* 5 — Accès rapides : les vues du chantier (Visites / Réunions / Frise…). */}
          <SiteQuickAccessCard siteId={siteId} showDocuments={siteDocCount > 0} showEvolution={hasEvolution} />

          {/* 6 — Préparer : LE rituel « avant de partir ». Deux CTA proéminents,
              pas des cartes passives — c'est un MOMENT du parcours (« j'appuie
              avant d'aller sur le chantier »). Présence (plus bas, « Aujourd'hui
              ici ») prend le relais UNE FOIS sur place : les deux sont
              complémentaires, jamais concurrents. */}
          <section className="space-y-2.5">
            <SiteBriefButton siteId={siteId} variant="mobile" mode="visit" />
            <SiteBriefButton siteId={siteId} variant="mobile" mode="meeting" />
          </section>

          {/* Contexte du lieu — référence & secondaire (sous la narration). */}
          {identity && <IdentityCard identity={identity} />}

          {/* « Aujourd'hui ici » — ce qui me concerne maintenant. En tête,
              l'assistant de présence : puisque je suis là, que puis-je saisir ? */}
          <section className="rounded-2xl border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aujourd&apos;hui ici
        </h2>

        <SitePresenceReminders reminders={presenceReminders} />

        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Hammer className="h-3.5 w-3.5" />{todayInterventions.length} interv.
          </span>
          {openActions.length > 0 && (
            <Link href={`/m/actions?site=${siteId}`} className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium active:bg-sky-100">
              <ListTodo className="h-3.5 w-3.5" />{openActions.length} action{openActions.length > 1 ? 's' : ''}
            </Link>
          )}
          {openAnomaliesCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />{openAnomaliesCount} anomalie{openAnomaliesCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {todayInterventions.length > 0 ? (
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
        ) : (
          <p className="text-sm text-muted-foreground italic">Aucune intervention prévue ici aujourd&apos;hui.</p>
        )}
      </section>

          {lastNotable && (
            <p className="text-[13px] italic text-muted-foreground leading-relaxed">
              Dernière trace ici : {formatTraceDate(lastNotable.date)},{' '}
              {lastNotable.text}.
            </p>
          )}

          {/* Mémoire IA périphérique — présence ambiante discrète (ignorable). */}
          {enrichedSiteReadings.readings.length > 0 && (
            <MobileSiteReadings readings={enrichedSiteReadings} siteId={siteId} />
          )}

          {/* Dernières preuves — photos récentes du site (lecture rapide). */}
          {recentPhotos.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
                <Camera className="h-4 w-4" /> Dernières preuves
              </h2>
              <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
                {recentPhotos.map((p) => (
                  <a
                    key={p.id}
                    href={p.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 snap-start block w-20 h-20 rounded-lg overflow-hidden border bg-muted active:opacity-80 transition-opacity"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.signedUrl} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Mémoire du chantier — cible de l'onglet « Mémoire » (ancre). */}
          <section id="memoire-lieu" className="scroll-mt-4 space-y-2 pt-3 border-t border-border/40">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Mémoire du chantier
            </h2>
            <TogglePanel label="Rechercher dans la mémoire" icon={<Search className="h-4 w-4" />}>
              <SiteMemoryQuery siteId={siteId} variant="mobile" />
            </TogglePanel>
          </section>

          {/* Ajouter… — outils de CRÉATION du lieu (grille d'outils, pas des CTA).
              On comprend d'un coup que ce sont des créations rapides. */}
          <section className="space-y-2 pt-3 border-t border-border/40">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ajouter…
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <QuickActionButton source="mobile_site" siteId={siteId} variant="mobile" />
              <SpontaneousCapturePanel siteId={siteId} siteName={site.name} />
              <SiteReportLauncher siteId={siteId} siteName={site.name} variant="mobile" label="Compte-rendu" resumeReportId={resumeReportId} />
              <DeliverFieldPanel siteId={siteId} />
            </div>
          </section>

          {/* 8 — Agir : « Démarrer une visite ». STICKY (F5) : le conducteur
              arrive gants sales pour capturer — l'action principale reste sous
              le pouce quelle que soit la longueur de la fiche. Le sticky est
              prouvé dans ce conteneur (le header top-0 du layout l'utilise) ;
              bottom-20 dégage la MobileTabBar (fixed bottom-0, ~4 rem + safe
              area). Toujours discrète (vert clair), jamais un slab noir. */}
          <div className="sticky bottom-20 z-30 drop-shadow-lg">
            <VisitLauncher siteId={siteId} activeVisit={null} />
          </div>
        </div>
      )}
    </div>
  )
}
