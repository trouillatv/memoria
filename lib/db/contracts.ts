import { createAdminClient } from '@/lib/supabase/admin'
import type { DbContract, ContractStatus } from '@/types/db'

// ============================================================================
// Sprint 5 — UX-9 Preuve de continuité (Doctrine V5)
// ============================================================================
//
// On mesure la stabilité du SERVICE, jamais des humains.
// Verrou V1 : mémoire ≠ recommandation. Compteurs descriptifs uniquement.
// Verrou V4 : pas de formulation de contrôle. Affichage subtil par l'évidence.
//
// Pas de comparaison entre contrats. Pas de ranking. Pas de score.
// Argument commercial par l'évidence, pas par superlatif.

export interface ContractContinuity {
  contractId: string
  contractStartDate: string
  /** Jours depuis contract.start_date (>= 0). */
  daysSinceStart: number
  /** Jours depuis max(executed_at). Si jamais exécuté → daysSinceStart. */
  daysSinceLastIntervention: number
  /** Mois consécutifs (jusqu'au mois courant inclus) avec >= 1 intervention executed. */
  consecutiveMonthsWithIntervention: number
  /** Semaines ISO consécutives rétroactives depuis aujourd'hui avec >= 1 intervention. */
  weeksWithoutInterruption: number
  totalExecutedInterventions: number
  totalPhotos: number
  totalAnomaliesResolved: number
}

const EXECUTED_STATUSES = ['completed', 'validated'] as const

/**
 * ISO week + year string ("2026-W19") pour une date donnée. Utilisé pour
 * regrouper les interventions par semaine ISO (lundi début).
 */
function isoWeekKey(d: Date): string {
  // Algo standard ISO 8601 : on travaille en UTC pour stabilité.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day) // jeudi de la semaine
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** "YYYY-MM" pour grouper par mois. */
function yearMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * getContractContinuity : compteurs factuels de stabilité du service.
 *
 * Doctrine : pas de score, pas de %, pas de classement. Faits bruts uniquement.
 * Le calcul ignore TOTALEMENT l'identité des intervenants.
 */
export async function getContractContinuity(contractId: string): Promise<ContractContinuity | null> {
  const supabase = createAdminClient()

  // 1) Contrat
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('id, start_date')
    .eq('id', contractId)
    .is('deleted_at', null)
    .maybeSingle()
  if (cErr) throw cErr
  if (!contract) return null

  // 2) Sites → missions → interventions executed (completed|validated)
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  const siteIds = (sites ?? []).map((s) => s.id as string)

  let missionIds: string[] = []
  if (siteIds.length > 0) {
    const { data: missions } = await supabase
      .from('missions')
      .select('id')
      .in('site_id', siteIds)
      .is('deleted_at', null)
    missionIds = (missions ?? []).map((m) => m.id as string)
  }

  const now = new Date()
  const startDate = new Date(contract.start_date as string)
  const daysSinceStart = Math.max(
    0,
    Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
  )

  // Defaults si aucun missions/intervention
  let totalExecutedInterventions = 0
  let totalPhotos = 0
  let totalAnomaliesResolved = 0
  let daysSinceLastIntervention = daysSinceStart
  let consecutiveMonthsWithIntervention = 0
  let weeksWithoutInterruption = 0

  if (missionIds.length > 0) {
    const { data: interventions, error: iErr } = await supabase
      .from('interventions')
      .select('id, executed_at')
      .in('mission_id', missionIds)
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .not('executed_at', 'is', null)
      .order('executed_at', { ascending: false })
      .limit(2000)
    if (iErr) throw iErr
    const rows = (interventions ?? []) as Array<{ id: string; executed_at: string }>
    totalExecutedInterventions = rows.length

    // daysSinceLastIntervention
    if (rows.length > 0) {
      const last = new Date(rows[0].executed_at)
      daysSinceLastIntervention = Math.max(
        0,
        Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)),
      )
    }

    // Compteurs cumul : photos + anomalies résolues sur ces interventions
    const interventionIds = rows.map((r) => r.id)
    if (interventionIds.length > 0) {
      const [{ count: photosCount, error: pErr }, { count: anomCount, error: aErr }] =
        await Promise.all([
          supabase
            .from('intervention_photos')
            .select('id', { count: 'exact', head: true })
            .in('intervention_id', interventionIds),
          supabase
            .from('intervention_anomalies')
            .select('id', { count: 'exact', head: true })
            .in('intervention_id', interventionIds)
            .not('resolved_at', 'is', null),
        ])
      if (pErr) throw pErr
      if (aErr) throw aErr
      totalPhotos = photosCount ?? 0
      totalAnomaliesResolved = anomCount ?? 0
    }

    // consecutiveMonthsWithIntervention : on compte les mois consécutifs
    // jusqu'au mois courant inclus qui contiennent >= 1 intervention executed.
    const monthsSet = new Set<string>()
    const weeksSet = new Set<string>()
    for (const r of rows) {
      const d = new Date(r.executed_at)
      monthsSet.add(yearMonthKey(d))
      weeksSet.add(isoWeekKey(d))
    }

    // Itère du mois courant en remontant tant que le mois est présent.
    let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    while (monthsSet.has(yearMonthKey(cursor))) {
      consecutiveMonthsWithIntervention += 1
      cursor.setUTCMonth(cursor.getUTCMonth() - 1)
      // Garde-fou : pas plus loin que la date de démarrage du contrat.
      if (cursor < new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))) {
        break
      }
    }

    // weeksWithoutInterruption : semaines ISO consécutives rétroactives depuis
    // la semaine courante avec >= 1 intervention executed.
    let weekCursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    while (weeksSet.has(isoWeekKey(weekCursor))) {
      weeksWithoutInterruption += 1
      weekCursor.setUTCDate(weekCursor.getUTCDate() - 7)
      // Garde-fou : pas plus loin que la date de démarrage du contrat.
      if (weekCursor < startDate) break
    }
  }

  return {
    contractId: contract.id as string,
    contractStartDate: contract.start_date as string,
    daysSinceStart,
    daysSinceLastIntervention,
    consecutiveMonthsWithIntervention,
    weeksWithoutInterruption,
    totalExecutedInterventions,
    totalPhotos,
    totalAnomaliesResolved,
  }
}

export async function getContract(id: string): Promise<DbContract | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listContracts(): Promise<DbContract[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export interface ContractListQuery {
  status?: ContractStatus
  search?: string
  offset?: number
  limit?: number
}

export interface ContractListResult {
  items: DbContract[]
  total: number
}

/**
 * Liste paginée des contrats du tenant.
 * Filtres optionnels : status, search (name + client_name).
 */
export async function listContractsPaged(query: ContractListQuery = {}): Promise<ContractListResult> {
  const supabase = createAdminClient()
  let q = supabase
    .from('contracts')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`name.ilike.%${s}%,client_name.ilike.%${s}%`)
  }

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error
  return {
    items: (data ?? []) as DbContract[],
    total: count ?? 0,
  }
}

export async function createContract(input: {
  tender_id: string | null
  name: string
  client_name: string
  start_date: string
  end_date?: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      tender_id: input.tender_id,
      name: input.name,
      client_name: input.client_name,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      status: 'active' as ContractStatus,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('contracts')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}
