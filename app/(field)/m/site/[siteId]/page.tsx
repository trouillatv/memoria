import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteResumeContext } from '@/lib/db/interventions'
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
import { SiteReportLauncher } from './SiteReportLauncher'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import { ListTodo, Hammer, AlertTriangle, ChevronRight, Camera } from 'lucide-react'

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
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
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

  // Actions ouvertes du site — « à suivre » côté terrain.
  const openActions = await listOpenSiteActions({ siteIds: [siteId] }).catch(() => [])

  // « Aujourd'hui ici » — page d'arrivée terrain. On s'assure des récurrences du
  // jour, puis on agrège interventions du jour + anomalies ouvertes + dernières
  // preuves. Réponse immédiate à « qu'est-ce qui me concerne ici, maintenant ? ».
  const todayIso = todayLocalIso()
  await ensureTodayInterventionsForSites([siteId], 0).catch(() => {})
  const { data: siteMissionRows } = await supabase
    .from('missions').select('id, name').eq('site_id', siteId).is('deleted_at', null)
  const missionNameById = new Map((siteMissionRows ?? []).map((m) => [m.id as string, m.name as string]))
  const siteMissionIds = [...missionNameById.keys()]
  type TodayIntv = { id: string; status: string; slot: 'morning' | 'afternoon' | 'evening' | null; planned_start: string | null; planned_end: string | null; mission_id: string }
  const todayInterventions: TodayIntv[] = siteMissionIds.length === 0
    ? []
    : (((await supabase
        .from('interventions')
        .select('id, status, slot, planned_start, planned_end, mission_id')
        .in('mission_id', siteMissionIds)
        .eq('scheduled_for', todayIso)
        .neq('status', 'skipped')
        .order('planned_start', { ascending: true })).data) ?? []) as TodayIntv[]
  const [siteAnomalies, recentPhotos] = await Promise.all([
    getSiteAnomalies(siteId).catch(() => []),
    getSiteRecentPhotos(siteId, 6).catch(() => []),
  ])
  const openAnomaliesCount = siteAnomalies.filter((a) => a.status === 'open').length

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
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          Bonjour {firstNameOf(user.full_name, user.email)}
        </h1>
      </header>

      <section className="space-y-1">
        <h2 className="text-2xl font-bold leading-tight">{site.name}</h2>
        <p className="text-sm text-muted-foreground">{nthPassage}ᵉ passage</p>
      </section>

      {/* « Aujourd'hui ici » — page d'arrivée : ce qui me concerne maintenant. */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aujourd&apos;hui ici
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Hammer className="h-3.5 w-3.5" />{todayInterventions.length} interv.
          </span>
          {openActions.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium">
              <ListTodo className="h-3.5 w-3.5" />{openActions.length} action{openActions.length > 1 ? 's' : ''}
            </span>
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
                    className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 active:bg-muted/40 transition-colors"
                  >
                    <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0 w-12">{time}</span>
                    <span className="text-sm font-medium min-w-0 flex-1 truncate">{missionNameById.get(i.mission_id) ?? 'Intervention'}</span>
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

      {/* V5.1.4 — Mémoire IA périphérique. Doctrine : présence ambiante
          discrète, 2 fragments max, gris léger. Joseph peut l'ignorer. */}
      {enrichedSiteReadings.readings.length > 0 && (
        <MobileSiteReadings readings={enrichedSiteReadings} siteId={siteId} />
      )}

      {/* À suivre — actions ouvertes du site (issues des réunions). */}
      {openActions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
            <ListTodo className="h-4 w-4" /> À suivre ({openActions.length})
          </h2>
          <OpenActionsList actions={openActions} compact />
        </section>
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

      {/* Compte-rendu multimodal : voix + texte + photos + pièces → décisions */}
      <SiteReportLauncher siteId={siteId} siteName={site.name} variant="mobile" />

      <SpontaneousCapturePanel siteId={siteId} />
    </div>
  )
}
