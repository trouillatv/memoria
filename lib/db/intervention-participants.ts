// ============================================================================
// lib/db/intervention-participants.ts — Phase 10, Slice 10.2
// ============================================================================
//
// Helpers DB pour `intervention_participants`. Interface STRICTEMENT BORNÉE.
//
// Doctrine V3 — cf. docs/superpowers/doctrines/planning-doctrine.md
//
//   ✅ Lecture par intervention (contexte d'événement connu)
//   ❌ Lecture par user (reverse lookup — refusé)
//   ❌ Comptage/aggrégation user-level (refusé)
//   ❌ Toute fonction *ByUser, *ByAgent, rank*, *Stats (refusé)
//
// La fonction `listInterventionsVisibleToUser` dans lib/db/interventions.ts est
// la SEULE query autorisée qui part d'un user_id, et elle est :
//   - bornée temporellement (J-1 → J+7)
//   - utilisée uniquement par la vue mobile opérationnelle /m
//   - PAS exploitable pour des stats ou de l'historique
//
// Si tu envisages d'ajouter ici une fonction qui ressemble à un reverse lookup,
// lis docs/superpowers/doctrines/refusals-log.md et la doctrine V3 d'abord.

import { createAdminClient } from '@/lib/supabase/admin'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ParticipantRole = 'participant' | 'referent'

export interface InterventionParticipant {
  intervention_id: string
  user_id: string
  role: ParticipantRole
  created_at: string
  created_by: string | null
}

export interface ParticipantWithUser extends InterventionParticipant {
  user: {
    id: string
    full_name: string | null
    email: string
  }
}

// ----------------------------------------------------------------------------
// READ — par intervention uniquement
// ----------------------------------------------------------------------------

/**
 * Liste les participants d'une intervention donnée, avec le profil utilisateur
 * (full_name, email) joint pour affichage. C'est la SEULE query de lecture
 * autorisée par la doctrine V3 — lookup par user_id interdit.
 */
export async function listParticipantsForIntervention(
  interventionId: string,
): Promise<ParticipantWithUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_participants')
    .select(
      `intervention_id, user_id, role, created_at, created_by,
       user:users!intervention_participants_user_id_fkey(id, full_name, email)`,
    )
    .eq('intervention_id', interventionId)
    .order('role', { ascending: false }) // referent first
    .order('created_at', { ascending: true })

  if (error) throw error

  const out: ParticipantWithUser[] = []
  for (const r of (data ?? []) as Array<{
    intervention_id: string
    user_id: string
    role: ParticipantRole
    created_at: string
    created_by: string | null
    user:
      | { id: string; full_name: string | null; email: string }
      | Array<{ id: string; full_name: string | null; email: string }>
      | null
  }>) {
    const user = Array.isArray(r.user) ? r.user[0] : r.user
    if (!user) continue
    out.push({
      intervention_id: r.intervention_id,
      user_id: r.user_id,
      role: r.role,
      created_at: r.created_at,
      created_by: r.created_by,
      user: { id: user.id, full_name: user.full_name, email: user.email },
    })
  }
  return out
}

/** Cardinalité seule (sans identités) — pour les exports anonymisés. */
export async function countParticipantsForIntervention(
  interventionId: string,
): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('intervention_participants')
    .select('*', { count: 'exact', head: true })
    .eq('intervention_id', interventionId)
  if (error) throw error
  return count ?? 0
}

// ----------------------------------------------------------------------------
// WRITE — set / add / remove
// ----------------------------------------------------------------------------

/**
 * Remplace l'ensemble des participants d'une intervention par la liste fournie.
 * Pattern set-style : DELETE puis bulk INSERT (UPDATE interdit côté DB).
 *
 * Le caller fournit `createdBy` (auth.uid()) pour respecter la policy INSERT
 * qui exige `created_by = auth.uid()`. La distinction de rôles permet de marquer
 * un referent unique sans avoir à faire deux appels.
 *
 * Refus côté DB (trigger immuabilité) si l'intervention est completed/validated
 * et que l'appelant n'est pas admin.
 */
export async function setParticipantsForIntervention(input: {
  interventionId: string
  participants: Array<{ user_id: string; role: ParticipantRole }>
  createdBy: string
}): Promise<void> {
  const supabase = createAdminClient()

  // 1) Vider
  const { error: delErr } = await supabase
    .from('intervention_participants')
    .delete()
    .eq('intervention_id', input.interventionId)
  if (delErr) throw delErr

  // 2) Insert si liste non vide
  if (input.participants.length === 0) return
  const rows = input.participants.map((p) => ({
    intervention_id: input.interventionId,
    user_id: p.user_id,
    role: p.role,
    created_by: input.createdBy,
  }))
  const { error: insErr } = await supabase
    .from('intervention_participants')
    .insert(rows)
  if (insErr) throw insErr
}

/** Ajoute un participant unitaire (NOOP si déjà présent). */
export async function addParticipant(input: {
  interventionId: string
  userId: string
  role?: ParticipantRole
  createdBy: string
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_participants')
    .upsert(
      {
        intervention_id: input.interventionId,
        user_id: input.userId,
        role: input.role ?? 'participant',
        created_by: input.createdBy,
      },
      { onConflict: 'intervention_id,user_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

/** Retire un participant unitaire. */
export async function removeParticipant(input: {
  interventionId: string
  userId: string
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_participants')
    .delete()
    .eq('intervention_id', input.interventionId)
    .eq('user_id', input.userId)
  if (error) throw error
}
