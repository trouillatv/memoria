'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { createMonthlyCapsule } from '@/lib/db/capsule-share'
import {
  renderMonthlyCapsule,
  formatMonthLabel,
  formatDateShort,
} from '@/lib/whatsapp/templates'

// V5.1 Slice 4 — Server action : préparer une capsule mensuelle WhatsApp.
//
// Doctrine Vincent 2026-05-14 :
//   - Patrick reste expéditeur via wa.me — l'app ne fait JAMAIS d'envoi auto.
//   - Phrase générée par template déterministe (renderMonthlyCapsule).
//     Aucune génération IA libre.
//   - Auto-sélection minimale en V5.1 : 1 photo saillante du mois + dernière
//     anomalie résolue (descriptive). Patrick valide via preview avant copie/envoi.

async function requireManager(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') {
    return { error: 'Forbidden' }
  }
  return { userId: user.id }
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

const prepareSchema = z.object({
  contractId: z.string().uuid(),
  reportMonth: z.string().regex(MONTH_REGEX, 'Format attendu YYYY-MM'),
})

export async function prepareMonthlyCapsuleAction(formData: FormData) {
  const auth = await requireManager()
  if ('error' in auth) return auth

  const parsed = prepareSchema.safeParse({
    contractId: formData.get('contractId'),
    reportMonth: formData.get('reportMonth'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { contractId, reportMonth } = parsed.data
  const supabase = createAdminClient()

  // 1. Récupérer les sites du contrat
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  if (!sites || sites.length === 0) {
    return { error: 'Aucun site sur ce contrat.' }
  }
  const siteIds = sites.map((s) => s.id)

  // 2. Récupérer les missions des sites
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) {
    return { error: 'Aucune mission sur les sites de ce contrat.' }
  }

  // 3. Récupérer les interventions du mois
  const monthStart = `${reportMonth}-01T00:00:00.000Z`
  const [year, month] = reportMonth.split('-').map(Number)
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEnd = `${nextMonth}-01T00:00:00.000Z`

  const { data: interventionsOfMonth } = await supabase
    .from('interventions')
    .select('id, executed_at, scheduled_at')
    .in('mission_id', missionIds)
    .gte('scheduled_at', monthStart)
    .lt('scheduled_at', monthEnd)
  const interventionsOfMonthIds = (interventionsOfMonth ?? []).map((i) => i.id)
  const passageCount = interventionsOfMonthIds.length

  if (passageCount === 0) {
    return { error: 'Aucun passage enregistré ce mois-ci sur ce contrat.' }
  }

  // 4. Sélectionner une photo saillante du mois (kind != 'before' pour éviter
  //    les photos préparatoires, on préfère 'proof' / 'anomaly' / 'passage' /
  //    'after'). Tri DESC par taken_at, on prend la plus récente.
  const { data: photos } = await supabase
    .from('intervention_photos')
    .select('id, taken_at, kind')
    .in('intervention_id', interventionsOfMonthIds)
    .neq('kind', 'before')
    .order('taken_at', { ascending: false })
    .limit(1)
  const photoId = photos?.[0]?.id
  if (!photoId) {
    return { error: 'Aucune photo notable ce mois-ci sur ce contrat.' }
  }

  // 5. Dernière anomalie (résolue ou non) du mois
  const { data: lastAnomalyArr } = await supabase
    .from('intervention_anomalies')
    .select('id, created_at, resolved_at, status')
    .in('intervention_id', interventionsOfMonthIds)
    .order('created_at', { ascending: false })
    .limit(1)
  const lastAnomaly = lastAnomalyArr?.[0]

  // 6. Générer la phrase via template déterministe
  const text = renderMonthlyCapsule({
    monthLabel: formatMonthLabel(reportMonth),
    passageCount,
    lastAnomalyShort: lastAnomaly ? formatDateShort(lastAnomaly.created_at) : null,
    lastAnomalyStatus: lastAnomaly?.status === 'resolved' ? 'resolved' : (lastAnomaly?.status ? 'open' : null),
  })

  // 7. Créer la capsule (proof_share_tokens avec presentation_kind=monthly_capsule)
  const token = await createMonthlyCapsule({
    contractId,
    reportMonth,
    photoId,
    dgNote: text,
    createdBy: auth.userId,
  })

  revalidatePath(`/contracts/${contractId}/capsule`)
  return { ok: true as const, token: token.token, text }
}
