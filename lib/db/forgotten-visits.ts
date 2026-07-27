import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

// ── CANDIDATS « VISITES OUBLIÉES » ───────────────────────────────────────────
// Deux notions, une même famille pour le cockpit (label « À anticiper » / « Visite
// oubliée ») :
//   1. Une visite/intervention PLANIFIÉE dont la date est passée sans réalisation.
//   2. Un chantier SANS visite terrain depuis longtemps (staleness).
// Ce module ne fait QUE lire des candidats bruts, org-scopés. Le détecteur (pur,
// testable) décide ensuite du seuil et fabrique les signaux.

/** Une intervention planifiée dont l'échéance civile est passée, encore 'planned'. */
export interface OverduePlannedVisit {
  interventionId: string
  siteId: string
  siteName: string
  organizationId: string
  missionName: string
  /** Date civile planifiée (yyyy-mm-dd). */
  scheduledFor: string
}

/** La dernière visite terrain terminée d'un chantier (null = jamais visité). */
export interface SiteLastVisit {
  siteId: string
  siteName: string
  organizationId: string
  lastVisitAt: string | null
}

export interface ForgottenVisitCandidates {
  overduePlanned: OverduePlannedVisit[]
  staleSites: SiteLastVisit[]
}

/**
 * Candidats « visites oubliées » d'une (ou plusieurs) organisation(s).
 *
 * Fenêtre bornée pour les interventions en retard : on ne remonte pas des
 * planifications fantômes vieilles de six mois — seulement le retard récent
 * (30 jours), qui reste rattrapable.
 */
export async function getForgottenVisitCandidates(orgIds: string[]): Promise<ForgottenVisitCandidates> {
  if (orgIds.length === 0) return { overduePlanned: [], staleSites: [] }
  const supabase = createAdminClient()
  const today = todayLocalIso()
  const windowStart = addDaysLocal(today, -30)

  // Sites de l'org (pour la staleness + la résolution des noms).
  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, name, organization_id')
    .in('organization_id', orgIds)
    .is('deleted_at', null)
  const sites = (siteRows ?? []) as Array<{ id: string; name: string; organization_id: string }>
  if (sites.length === 0) return { overduePlanned: [], staleSites: [] }
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const siteIds = sites.map((s) => s.id)

  const [intvRes, reportRes] = await Promise.all([
    // Interventions planifiées en retard (échéance civile passée, encore 'planned').
    supabase
      .from('interventions')
      .select('id, mission_id, scheduled_for, organization_id')
      .in('organization_id', orgIds)
      .eq('status', 'planned')
      .gte('scheduled_for', windowStart)
      .lt('scheduled_for', today),
    // Dernière visite terrain terminée par site (origin non nul = visite, pas réunion).
    supabase
      .from('site_reports')
      .select('site_id, ended_at')
      .in('site_id', siteIds)
      .not('origin', 'is', null)
      .not('ended_at', 'is', null)
      .is('deleted_at', null)
      .order('ended_at', { ascending: false }),
  ])

  // Résolution mission → site + nom pour les interventions en retard.
  const intvs = (intvRes.data ?? []) as Array<{ id: string; mission_id: string; scheduled_for: string; organization_id: string }>
  const missionIds = [...new Set(intvs.map((i) => i.mission_id).filter(Boolean))]
  const missionById = new Map<string, { name: string; site_id: string }>()
  if (missionIds.length > 0) {
    const { data: missionRows } = await supabase
      .from('missions')
      .select('id, name, site_id')
      .in('id', missionIds)
      .is('deleted_at', null)
    for (const m of (missionRows ?? []) as Array<{ id: string; name: string; site_id: string }>) {
      missionById.set(m.id, { name: m.name, site_id: m.site_id })
    }
  }

  const overduePlanned: OverduePlannedVisit[] = []
  for (const i of intvs) {
    const mission = missionById.get(i.mission_id)
    if (!mission) continue
    const site = siteById.get(mission.site_id)
    if (!site) continue
    overduePlanned.push({
      interventionId: i.id,
      siteId: site.id,
      siteName: site.name,
      organizationId: site.organization_id,
      missionName: mission.name,
      scheduledFor: i.scheduled_for,
    })
  }

  // Dernière visite par site (le premier vu = le plus récent, requête triée desc).
  const lastVisitBySite = new Map<string, string>()
  for (const r of (reportRes.data ?? []) as Array<{ site_id: string; ended_at: string }>) {
    if (!lastVisitBySite.has(r.site_id)) lastVisitBySite.set(r.site_id, r.ended_at)
  }
  // Staleness : uniquement les chantiers DÉJÀ visités au moins une fois. Un
  // chantier jamais visité relève de l'accueil/onboarding, pas de l'oubli — on
  // évite ainsi le bruit sur les sites tout juste créés.
  const staleSites: SiteLastVisit[] = sites
    .filter((s) => lastVisitBySite.has(s.id))
    .map((s) => ({
      siteId: s.id,
      siteName: s.name,
      organizationId: s.organization_id,
      lastVisitAt: lastVisitBySite.get(s.id) ?? null,
    }))

  return { overduePlanned, staleSites }
}
