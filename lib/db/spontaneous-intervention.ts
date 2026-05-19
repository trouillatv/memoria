// V5.1 — Find-or-create intervention spontanée pour dépôt photo libre.
//
// Pattern : quand Joseph dépose une photo libre sur un site, on attache cette
// photo à une intervention "spontanée" auto-créée sur la mission système
// "Traces libres du site" (cf. lib/db/system-missions.ts).
//
// Fenêtre 4h : si une intervention spontanée existe déjà pour la team de
// l'agent sur ce site dans les 4h passées, on la réutilise. Sinon on en crée
// une nouvelle. Conséquence : Joseph qui dépose 3 photos à l'arrivée + 2 en
// repartant 2h plus tard = 1 seule intervention avec 5 photos. Joseph qui
// revient le lendemain = nouvelle intervention.
//
// Doctrine V2 : l'intervention est attachée à la team de l'agent (conteneur
// logistique), pas nominativement à Joseph. Plusieurs agents de la même team
// partagent une intervention spontanée s'ils passent dans la même fenêtre 4h
// — cohérent avec "l'équipe assure la couverture".
//
// Garde-fous gravés :
//   - team=[] (array vide) : l'intervention spontanée n'apparaît PAS dans
//     listInterventionsVisibleToUser (qui filtre via .contains('team', [user])).
//     Joseph la voit via la page Site (Slice 3), pas via /m.
//   - assigned_team_id NOT NULL obligatoire (contrainte DB 048) → on prend la
//     première team active de l'agent.
//   - status='completed' direct (pas de transition planned → completed),
//     executed_at = now()
//   - Si l'agent n'a aucune team active → erreur applicative explicite.
//
// Décision Vincent 2026-05-14 : option Alpha, pas de nouvelle colonne sur
// interventions. Le caractère "système" est porté par la mission, pas par
// l'intervention.

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureSystemMission } from '@/lib/db/system-missions'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { todayLocalIso } from '@/lib/time/local-date'
import { buildScheduledAt, currentSlot } from '@/lib/time/prestation-slot'
import type { DbIntervention, InterventionSlot, InterventionStatus } from '@/types/db'

const SPONTANEOUS_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 heures

// `currentSlot` (slot depuis l'heure UTC) : module canonique
// `@/lib/time/prestation-slot` — fin du reverse `h<12 / h<17` dupliqué (V6.1).

export class NoActiveTeamError extends Error {
  constructor(userId: string) {
    super(`L'agent ${userId} n'est membre actif d'aucune équipe. Demande au gérant de t'affecter.`)
    this.name = 'NoActiveTeamError'
  }
}

/**
 * Find-or-create l'intervention spontanée pour (userId, siteId) avec une
 * fenêtre de réutilisation de 4h.
 *
 * Returns: { intervention, created } — `created=true` si une nouvelle ligne
 * a été insérée, `false` si on a réutilisé une intervention existante.
 *
 * Throws NoActiveTeamError si l'user n'a aucune team active (cas limite à
 * exposer côté UI comme erreur descriptive).
 */
export async function findOrCreateSpontaneousIntervention(
  userId: string,
  siteId: string,
): Promise<{ intervention: DbIntervention; created: boolean }> {
  const supabase = createAdminClient()

  // 1) S'assurer que la mission système existe sur ce site
  const systemMission = await ensureSystemMission(siteId, userId)

  // 2) Récupérer les teams actives de l'agent — au moins une requise
  const userTeamIds = await listActiveTeamIdsForUser(userId)
  if (userTeamIds.length === 0) {
    throw new NoActiveTeamError(userId)
  }

  // 3) Chercher une intervention spontanée récente sur ce site, attachée à
  //    une team de l'user (fenêtre 4h)
  const windowStartIso = new Date(Date.now() - SPONTANEOUS_WINDOW_MS).toISOString()
  const { data: existing, error: fetchErr } = await supabase
    .from('interventions')
    .select('*')
    .eq('mission_id', systemMission.id)
    .in('assigned_team_id', userTeamIds)
    .gte('executed_at', windowStartIso)
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (existing) {
    return { intervention: existing as DbIntervention, created: false }
  }

  // 4) Créer une intervention spontanée
  //    - mission_id = mission système
  //    - assigned_team_id = première team active de l'user (satisfait contrainte 048)
  //    - team=[] : vide pour ne PAS polluer listInterventionsVisibleToUser
  //    - status='completed' direct, executed_at=now()
  //    - scheduled_for=today, slot dérivé de l'heure UTC courante
  const now = new Date()
  const today = todayLocalIso()
  const slot = currentSlot(now)
  // scheduled_at dérivé du slot via le module canonique (V6.1).
  const scheduledAt = buildScheduledAt(today, slot)

  const { data: inserted, error: insertErr } = await supabase
    .from('interventions')
    .insert({
      mission_id: systemMission.id,
      scheduled_at: scheduledAt,
      scheduled_for: today,
      slot,
      // V6.1 — champ honnête de la prestation (= ancrage canonique).
      planned_start: scheduledAt,
      team: [],
      assigned_team_id: userTeamIds[0],
      status: 'completed' satisfies InterventionStatus,
      executed_at: now.toISOString(),
      created_by: userId,
    })
    .select('*')
    .single()
  if (insertErr) throw insertErr

  return { intervention: inserted as DbIntervention, created: true }
}
