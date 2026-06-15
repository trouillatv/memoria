import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteResumeContext } from '@/lib/db/interventions'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSiteReadings,
  getSiteHumanContinuity,
  getSiteTransmissionReadings,
} from '@/lib/db/site-cockpit'
import { MobileSiteReadings } from '@/components/field/MobileSiteReadings'
import { SpontaneousCapturePanel } from './SpontaneousCapturePanel'
import { SiteReportLauncher } from './SiteReportLauncher'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import { ListTodo } from 'lucide-react'

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

      {/* Compte-rendu multimodal : voix + texte + photos + pièces → décisions */}
      <SiteReportLauncher siteId={siteId} siteName={site.name} variant="mobile" />

      <SpontaneousCapturePanel siteId={siteId} />
    </div>
  )
}
