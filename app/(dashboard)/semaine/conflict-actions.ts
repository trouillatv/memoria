'use server'

// PL3b — les cinq gestes face à « site fermé, prestation prévue ».
//
//   déplacer AVANT · déplacer APRÈS · une AUTRE date · MAINTENIR · ANNULER
//
// ⚖️ MEMORIA NE DÉCIDE JAMAIS. Il propose des dates OUVERTES ; l'humain tranche ;
//    la décision est TRACÉE et se relit un an plus tard.
//
// Aucun second moteur : déplacer, c'est `moveInterventionToDayAction` (le même
// que le drag-and-drop, avec ses gardes) ; annuler, c'est le `skipped` qui
// existe déjà. On n'ajoute que la TRACE — et « maintenir », qui n'existait pas.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { recordDecision } from '@/lib/db/closure-decisions'
import {
  validateChosenDate,
  resolutionOptions,
  type ResolutionOption,
} from '@/lib/planning/conflict-resolution'
import { todayLocalIso } from '@/lib/time/local-date'
import { logAuditEvent } from '@/lib/audit/log'
import { moveInterventionToDayAction } from './actions'

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')

const schema = z.object({
  interventionId: z.string().uuid(),
  closureId: z.string().uuid(),
  /** Le jour du conflit — pour relire la décision sans la reconstituer. */
  conflictDate: dateIso,
  decision: z.enum(['moved', 'kept', 'cancelled']),
  /** Obligatoire si `moved`. */
  movedTo: dateIso.nullable().optional(),
  /** « On y va quand même » / « on annule » : pourquoi. Facultatif. */
  note: z.string().trim().max(300).optional(),
})

export type ResolveResult = { ok: true; message: string } | { error: string }

export async function resolveConflictAction(input: unknown): Promise<ResolveResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const d = parsed.data

  const owned = await requireOwned(auth.role, 'interventions', d.interventionId)
  if (!owned.allowed) return { error: owned.error }

  const db = createAdminClient()

  // Le chantier de l'intervention — pour vérifier la date proposée contre SES
  // fermetures, pas celles d'un autre.
  const { data: row } = await db
    .from('interventions')
    .select('id, status, missions!inner(site_id)')
    .eq('id', d.interventionId)
    .maybeSingle()

  const siteId = (row as { missions?: { site_id?: string } } | null)?.missions?.site_id
  if (!siteId) return { error: 'Intervention introuvable' }

  let message = ''

  if (d.decision === 'moved') {
    if (!d.movedTo) return { error: 'Choisissez une date' }

    // On ne remplace pas un conflit par un autre : la date d'arrivée doit être
    // OUVERTE. La règle est pure et testée ; ici on ne fait que l'appliquer.
    const closures = await listActiveClosuresForSites([siteId], d.movedTo, d.movedTo).catch(
      (): Record<string, SiteClosure[]> => ({}),
    )
    const verdict = validateChosenDate(closures[siteId] ?? [], d.movedTo, todayLocalIso())
    if (!verdict.ok) return { error: verdict.reason }

    // Le MÊME chemin que le drag-and-drop : ses gardes, ses règles, son idempotence.
    const moved = await moveInterventionToDayAction({
      interventionId: d.interventionId,
      newScheduledFor: d.movedTo,
    })
    // `MoveResult.error` est optionnel : un refus sans message resterait muet.
    if (!moved.ok) return { error: moved.error ?? 'Déplacement refusé' }
    message = 'Prestation déplacée.'
  }

  if (d.decision === 'cancelled') {
    // « Annuler » = le `skipped` qui existe déjà. On n'invente pas un statut.
    const { error } = await db
      .from('interventions')
      .update({
        status: 'skipped',
        skipped_at: new Date().toISOString(),
        skipped_reason: d.note?.trim() || 'Chantier fermé',
      })
      .eq('id', d.interventionId)
      .eq('status', 'planned') // on n'annule pas ce qui est déjà commencé ou fait
    if (error) return { error: error.message }
    message = 'Prestation annulée.'
  }

  if (d.decision === 'kept') {
    // Rien à écrire sur l'intervention : elle reste PLANNED, on y va vraiment.
    // C'est la TRACE qui fait tout le travail — sans elle, le conflit se
    // ré-afficherait demain matin, et après-demain.
    message = 'Maintenue — le conflit ne sera plus signalé.'
  }

  await recordDecision({
    interventionId: d.interventionId,
    closureId: d.closureId,
    decision: d.decision,
    movedTo: d.movedTo ?? null,
    conflictDate: d.conflictDate,
    userId: auth.userId,
  })

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: siteId,
    action: 'updated',
    metadata: {
      kind: 'closure_conflict_decision',
      intervention_id: d.interventionId,
      decision: d.decision,
      conflict_date: d.conflictDate,
      moved_to: d.movedTo ?? null,
    },
  })

  revalidatePath('/semaine')
  revalidatePath('/dashboard')
  revalidatePath(`/sites/${siteId}`)

  return { ok: true, message }
}


/**
 * Les dates PROPOSÉES pour ce conflit — calculées sur les vraies fermetures du
 * chantier, jamais devinées à l'écran.
 *
 * On regarde ±14 jours autour du conflit : au-delà, proposer une date n'aiderait
 * personne (une fermeture annuelle ne se règle pas par un déplacement de trois
 * semaines). Si rien n'est ouvert, on ne propose RIEN — un bouton qui mène à un
 * autre conflit est pire qu'un bouton absent.
 */
export async function conflictOptionsAction(input: {
  interventionId: string
  conflictDate: string
}): Promise<{ ok: true; options: ResolutionOption[] } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = z
    .object({ interventionId: z.string().uuid(), conflictDate: dateIso })
    .safeParse(input)
  if (!parsed.success) return { error: 'Saisie invalide' }

  const owned = await requireOwned(auth.role, 'interventions', parsed.data.interventionId)
  if (!owned.allowed) return { error: owned.error }

  const db = createAdminClient()
  const { data: row } = await db
    .from('interventions')
    .select('id, missions!inner(site_id)')
    .eq('id', parsed.data.interventionId)
    .maybeSingle()

  const siteId = (row as { missions?: { site_id?: string } } | null)?.missions?.site_id
  if (!siteId) return { error: 'Intervention introuvable' }

  const from = shiftIso(parsed.data.conflictDate, -14)
  const to = shiftIso(parsed.data.conflictDate, 14)
  const closures = await listActiveClosuresForSites([siteId], from, to).catch(
    (): Record<string, SiteClosure[]> => ({}),
  )

  const today = todayLocalIso()
  const options = resolutionOptions(closures[siteId] ?? [], parsed.data.conflictDate).filter(
    // On ne propose jamais de replanifier dans le passé.
    (o) => o.date >= today,
  )

  return { ok: true, options }
}

function shiftIso(dateIso: string, days: number): string {
  const t = new Date(`${dateIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(t)) return dateIso
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}
