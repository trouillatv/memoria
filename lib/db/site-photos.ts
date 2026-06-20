// Photos d'un site — STRUCTURE réutilisable (PV, DOE, réserves, recherche).
//
// Objectif (Vincent 2026-06-20) : enrichir la MÉMOIRE, pas générer. On expose la
// chaîne « photo → (action | intervention | anomalie) → date → auteur → légende »
// de façon unifiée et déterministe. La génération (URLs signées, boucle image du
// template) viendra après.
//
// Sources :
//   - intervention_photos (via missions.site_id → interventions.mission_id)
//   - site_actions.completed_photo_path (photo de clôture d'action)

import { createAdminClient } from '@/lib/supabase/admin'
import { listReportPhotos } from './report-photos'

export interface SitePhoto {
  id: string
  storagePath: string
  /** Légende : commentaire humain prioritaire, sinon légende IA, sinon vide. */
  legende: string
  takenAt: string | null
  /** Auteur = id de l'utilisateur (traçabilité). Résolution du nom = plus tard. */
  authorId: string | null
  interventionId: string | null
  anomalyId: string | null
  actionId: string | null
  source: 'intervention' | 'action' | 'report'
}

/**
 * Photos PERTINENTES POUR CE CR (pas tout le site). Un CR couvre une PÉRIODE :
 * depuis la réunion précédente jusqu'à celle-ci. On filtre par `takenAt` dans cette
 * fenêtre (sinon, à 250 photos de chantier, le CR devient ingérable — Vincent
 * 2026-06-20). 1re réunion = pas de borne basse. Photos non datées : exclues d'une
 * vue fenêtrée (on ne peut pas les situer), sauf 1re réunion.
 */
export async function listMeetingScopedPhotos(report: {
  id: string
  site_id: string | null
  created_at: string
}): Promise<SitePhoto[]> {
  if (!report.site_id) return []
  const all = await listSitePhotos(report.site_id)
  const sb = createAdminClient()
  const { data: prev } = await sb
    .from('site_reports')
    .select('created_at')
    .eq('site_id', report.site_id)
    .lt('created_at', report.created_at)
    .neq('id', report.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const since = (prev as { created_at: string } | null)?.created_at ?? null
  const until = report.created_at
  const scoped = all.filter((p) => {
    if (!p.takenAt) return since === null // non datée : gardée seulement à la 1re réunion
    return p.takenAt <= until && (since === null || p.takenAt > since)
  })
  // Photos AJOUTÉES directement à CE CR (mig 133) : toujours incluses (rattachées au
  // report, pas au site → hors logique de fenêtre). Plus récentes d'abord, en tête.
  const reportPhotos = await listReportPhotos(report.id)
  return [...reportPhotos, ...scoped]
}

/** Toutes les photos rattachées à un site, triées de la plus récente à la plus ancienne. */
export async function listSitePhotos(siteId: string): Promise<SitePhoto[]> {
  const sb = createAdminClient()
  const photos: SitePhoto[] = []

  // 1) Photos d'intervention (source principale, multimodale terrain).
  const { data: missions } = await sb.from('missions').select('id').eq('site_id', siteId).is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id as string)
  if (missionIds.length > 0) {
    const { data: interventions } = await sb.from('interventions').select('id').in('mission_id', missionIds)
    const intvIds = (interventions ?? []).map((i) => i.id as string)
    if (intvIds.length > 0) {
      const { data } = await sb
        .from('intervention_photos')
        .select('id, storage_path, caption, ai_caption, taken_at, taken_by, intervention_id, anomaly_id')
        .in('intervention_id', intvIds)
        .order('taken_at', { ascending: false })
      for (const p of data ?? []) {
        photos.push({
          id: p.id as string,
          storagePath: p.storage_path as string,
          legende: ((p.caption as string | null) ?? (p.ai_caption as string | null) ?? '').trim(),
          takenAt: (p.taken_at as string | null) ?? null,
          authorId: (p.taken_by as string | null) ?? null,
          interventionId: (p.intervention_id as string | null) ?? null,
          anomalyId: (p.anomaly_id as string | null) ?? null,
          actionId: null,
          source: 'intervention',
        })
      }
    }
  }

  // 2) Photos de clôture d'action (preuve d'exécution).
  const { data: actions } = await sb
    .from('site_actions')
    .select('id, completed_photo_path, completed_comment, done_at')
    .eq('site_id', siteId)
    .not('completed_photo_path', 'is', null)
  for (const a of actions ?? []) {
    photos.push({
      id: a.id as string,
      storagePath: a.completed_photo_path as string,
      legende: ((a.completed_comment as string | null) ?? '').trim(),
      takenAt: (a.done_at as string | null) ?? null,
      authorId: null, // qui a clôturé n'est pas tracé séparément → pas d'attribution devinée
      interventionId: null,
      anomalyId: null,
      actionId: a.id as string,
      source: 'action',
    })
  }

  return photos.sort((x, y) => (y.takenAt ?? '').localeCompare(x.takenAt ?? ''))
}
