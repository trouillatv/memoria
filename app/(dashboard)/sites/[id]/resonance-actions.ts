'use server'

// B1 — dismiss minimal d'une résonance documentaire (lecture site).
//
// Spec : docs/superpowers/specs/2026-05-20-niveau-b-documents-memoire-
//        relationnelle.md — humain dans la boucle, jamais d'auto-exposition.
//
// Geste sobre : status='dismissed' + audit. Pas de raison libre (V5/V6.4 :
// l'IA est révélateur, pas notation ; dismiss ne sert pas à classer un doc
// mais à dire « cette résonance n'est pas pertinente ici »).
//
// Auth : manager+ (cohérent avec actions site existantes).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { logAuditEvent } from '@/lib/audit/log'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const dismissSchema = z.object({
  candidate_id: z.string().uuid(),
  site_id: z.string().uuid(),
})

export async function dismissResonanceAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = dismissSchema.safeParse({
    candidate_id: formData.get('candidate_id'),
    site_id: formData.get('site_id'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  const admin = createAdminClient()

  // Lecture vérifiée avant update : éviter de marquer 'dismissed' un row
  // d'un autre site (URL forgée).
  const { data: row } = await admin
    .from('site_reading_candidates')
    .select('id, site_id, reading_type, algorithm_version, status')
    .eq('id', parsed.data.candidate_id)
    .maybeSingle()
  if (!row) return { error: 'Not found' }
  const r = row as {
    id: string; site_id: string; reading_type: string;
    algorithm_version: string; status: string
  }
  if (r.site_id !== parsed.data.site_id) return { error: 'Forbidden' }
  if (r.status !== 'active') return { ok: true as const } // idempotent

  const { error: upErr } = await admin
    .from('site_reading_candidates')
    .update({ status: 'dismissed' })
    .eq('id', r.id)
  if (upErr) return { error: upErr.message }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: r.site_id,
    action: 'updated',
    metadata: {
      kind: 'resonance_dismissed',
      candidate_id: r.id,
      reading_type: r.reading_type,
      algorithm_version: r.algorithm_version,
    },
  })

  revalidatePath(`/sites/${r.site_id}`)
  return { ok: true as const }
}

// Sprint D (l'oubli) — résolution explicite : « ce sujet a existé puis a été
// traité ». État « Clos » dans la grammaire du temps mémoriel. DISTINCT de
// dismiss (« c'était faux ») : ici la mémoire est conservée, juste mise en
// sommeil parce que le sujet est traité. Réversible via reactivateResonanceAction.
export async function resolveResonanceAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = dismissSchema.safeParse({
    candidate_id: formData.get('candidate_id'),
    site_id: formData.get('site_id'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('site_reading_candidates')
    .select('id, site_id, reading_type, algorithm_version, status')
    .eq('id', parsed.data.candidate_id)
    .maybeSingle()
  if (!row) return { error: 'Not found' }
  const r = row as {
    id: string; site_id: string; reading_type: string;
    algorithm_version: string; status: string
  }
  if (r.site_id !== parsed.data.site_id) return { error: 'Forbidden' }
  if (r.status === 'resolved') return { ok: true as const } // idempotent
  if (r.status !== 'active') return { error: 'Not active' }

  const { error: upErr } = await admin
    .from('site_reading_candidates')
    .update({ status: 'resolved' })
    .eq('id', r.id)
  if (upErr) return { error: upErr.message }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: r.site_id,
    action: 'updated',
    metadata: {
      kind: 'resonance_resolved',
      candidate_id: r.id,
      reading_type: r.reading_type,
      algorithm_version: r.algorithm_version,
    },
  })

  revalidatePath(`/sites/${r.site_id}`)
  return { ok: true as const }
}

// Réversibilité doctrinale : un « Clos » peut être ré-ouvert (repasse Présent).
// Données jamais détruites — c'est un simple changement de statut, audité.
export async function reactivateResonanceAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = dismissSchema.safeParse({
    candidate_id: formData.get('candidate_id'),
    site_id: formData.get('site_id'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('site_reading_candidates')
    .select('id, site_id, reading_type, algorithm_version, status')
    .eq('id', parsed.data.candidate_id)
    .maybeSingle()
  if (!row) return { error: 'Not found' }
  const r = row as {
    id: string; site_id: string; reading_type: string;
    algorithm_version: string; status: string
  }
  if (r.site_id !== parsed.data.site_id) return { error: 'Forbidden' }
  if (r.status === 'active') return { ok: true as const } // idempotent
  // Ne ré-ouvre que ce qui a été clos/écarté par un humain (jamais un stale auto).
  if (r.status !== 'resolved' && r.status !== 'dismissed') return { error: 'Not reversible' }

  const { error: upErr } = await admin
    .from('site_reading_candidates')
    .update({ status: 'active' })
    .eq('id', r.id)
  if (upErr) return { error: upErr.message }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: r.site_id,
    action: 'updated',
    metadata: {
      kind: 'resonance_reactivated',
      candidate_id: r.id,
      reading_type: r.reading_type,
      algorithm_version: r.algorithm_version,
    },
  })

  revalidatePath(`/sites/${r.site_id}`)
  return { ok: true as const }
}
