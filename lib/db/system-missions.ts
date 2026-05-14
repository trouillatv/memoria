// V5.1 — Missions système (Sprint 2026-05-14).
//
// Doctrine : pour permettre le dépôt photo spontané sur un site hors workflow
// d'intervention pré-planifiée (Slice 1), on utilise une mission "système"
// par site, de cadence='on_demand', invisible des vues planning. C'est elle
// qui sert de container logistique pour les traces libres déposées par les
// agents au fil de leurs passages.
//
// Décision Vincent 2026-05-14 : option Alpha (extension), pas de
// boolean `is_spontaneous` sur interventions. On exploite la cadence
// 'on_demand' déjà gravée dans l'enum (migration 018) et jamais utilisée
// jusqu'ici.
//
// Garde-fou central : toute query "planning" qui liste les missions DOIT
// utiliser getPlanningMissions(...) ou explicitement filtrer
// `cadence !== 'on_demand'`. Sinon les traces libres polluent les vues
// d'organisation prévue.
//
// Voir docs/superpowers/notes/2026-05-14-audit-slice1.md pour le contexte
// décisionnel complet.

import { createAdminClient } from '@/lib/supabase/admin'
import { createMission, getMission, listMissionsBySite } from '@/lib/db/missions'
import type { DbMission } from '@/types/db'

/**
 * Liste exhaustive des noms de missions traitées comme système.
 * Toute query planning DOIT exclure les missions dont le nom est dans cette
 * liste ET dont la cadence est 'on_demand' (cf. isSystemMission).
 *
 * Si on ajoute un nouveau type de mission système dans le futur, l'ajouter
 * ici. Aucune autre source de vérité.
 */
export const SYSTEM_MISSION_NAMES = ['Traces libres du site'] as const

export type SystemMissionName = (typeof SYSTEM_MISSION_NAMES)[number]

/**
 * Détecte si une mission est une mission système.
 *
 * Critère double : cadence ET name. Une mission `on_demand` créée par un user
 * (ex. mission ponctuelle ad-hoc valide) ne sera PAS détectée comme système si
 * son nom n'est pas dans la liste. Inversement, une mission qui porterait par
 * accident le nom "Traces libres du site" mais avec une autre cadence ne le
 * sera pas non plus.
 */
export function isSystemMission(m: { name: string; cadence: string }): boolean {
  return (
    m.cadence === 'on_demand' &&
    (SYSTEM_MISSION_NAMES as readonly string[]).includes(m.name)
  )
}

/**
 * Variante "name-only" pour filter les vues qui n'ont pas chargé `cadence`
 * dans leur SELECT (vue semaine, page missions, picker planification).
 * Moins strict que isSystemMission() mais suffisant en pratique : aucun user
 * légitime ne créerait une mission avec exactement ce nom.
 */
export function isSystemMissionName(name: string): boolean {
  return (SYSTEM_MISSION_NAMES as readonly string[]).includes(name)
}

/**
 * Find-or-create la mission système "Traces libres du site" pour un site donné.
 *
 * Idempotent : si la mission existe déjà (active, non supprimée), elle est
 * retournée telle quelle. Sinon une nouvelle est créée avec :
 *   - cadence='on_demand'
 *   - default_team=[]   (pas d'équipe affectée par défaut — la mission n'est
 *                       jamais planifiée)
 *   - default_checklist=[] (pas de checklist — c'est une trace libre)
 *   - engagement_ids=[]
 *   - assigned_team_id=null
 *
 * createdBy peut être null si l'appel est purement système (ex. seed). En
 * pratique côté Slice 1, on passe le userId de l'agent qui déclenche la
 * création (Joseph).
 */
export async function ensureSystemMission(
  siteId: string,
  createdBy: string | null,
): Promise<DbMission> {
  const supabase = createAdminClient()

  // 1) Chercher une mission système existante sur ce site
  const { data: existing, error: fetchErr } = await supabase
    .from('missions')
    .select('*')
    .eq('site_id', siteId)
    .eq('cadence', 'on_demand')
    .in('name', SYSTEM_MISSION_NAMES as readonly string[])
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) return existing as DbMission

  // 2) Créer la mission système
  const id = await createMission({
    site_id: siteId,
    name: 'Traces libres du site',
    description: 'Mission système V5.1. Container des traces déposées spontanément sur ce site, hors workflow d\'intervention planifiée. JAMAIS afficher dans le planning.',
    cadence: 'on_demand',
    default_team: [],
    engagement_ids: [],
    default_checklist: [],
    created_by: createdBy,
  })

  const created = await getMission(id)
  if (!created) {
    throw new Error(`ensureSystemMission: mission créée mais introuvable (site=${siteId}, id=${id})`)
  }
  return created
}

/**
 * Liste les missions d'un site PLANNING-ready : exclut les missions système.
 *
 * À utiliser à la place de listMissionsBySite() dans TOUTE vue planning,
 * dashboard, ou organisation prévue. Si une PR ajoute une nouvelle vue qui
 * liste les missions d'un site, elle doit passer par ce helper.
 */
export async function getPlanningMissions(siteId: string): Promise<DbMission[]> {
  const all = await listMissionsBySite(siteId)
  return all.filter((m) => !isSystemMission(m))
}

/**
 * Helper inverse : liste UNIQUEMENT les missions système d'un site (utile
 * pour la page Site V5.1 / dépôt spontané qui exploite la mission système
 * comme container).
 */
export async function getSystemMissionsBySite(siteId: string): Promise<DbMission[]> {
  const all = await listMissionsBySite(siteId)
  return all.filter((m) => isSystemMission(m))
}
