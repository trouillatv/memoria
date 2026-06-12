import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso, localDateOf } from '@/lib/time/local-date'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { canViewDocument } from '@/lib/documents/access'
import type { DbContract, ContractStatus, UserRole } from '@/types/db'

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
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
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
    const weekCursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
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
  const orgId = await getOrgId()
  let q = supabase.from('contracts').select('*').is('deleted_at', null).order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
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
  const orgId = await getOrgId()
  let q = supabase
    .from('contracts')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)

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
  const orgId = await getOrgId()
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
      ...(orgId ? { organization_id: orgId } : {}),
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

/**
 * V6.3 — attributs « entité vivante » du contrat : volume horaire mensuel
 * prévu + rythme. Propriétés DU CONTRAT (non humaines, test V2 passe).
 * `volume_horaire_mensuel` est une cible du contrat, jamais agrégée par
 * personne (pare-feu V6.1). Champs partiels : seuls les fournis sont écrits.
 */
export async function updateContractEntity(
  id: string,
  patch: { volume_horaire_mensuel?: number | null; frequence?: string | null },
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (patch.volume_horaire_mensuel !== undefined) {
    updates.volume_horaire_mensuel = patch.volume_horaire_mensuel
  }
  if (patch.frequence !== undefined) updates.frequence = patch.frequence
  if (Object.keys(updates).length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase.from('contracts').update(updates).eq('id', id)
  if (error) throw error
}

// ============================================================================
// V6.3 tranche 2 — agrégation factuelle DÉTERMINISTE (zéro LLM, zéro score)
// ============================================================================
//
// Doctrine V6.3 : la mémoire du contrat est une agrégation factuelle
// recomposée, JAMAIS un avis. V6.4 : pas de score/tension/% — uniquement des
// faits qu'un humain n'aurait pas vus seul, ignorables sans friction.
//
// CONCESSION HONNÊTE (registre V6.2) — investigation 2026-05-19 : il n'existe
// AUCUNE durée par intervention en base (`started_at` est sur `missions`, pas
// sur `interventions` ; seul `executed_at` existe). On NE FABRIQUE PAS d'heures
// consommées (ce serait exactement la fausse précision que le Substrat V6.1
// corrige). On expose l'objectif déclaré du contrat vs le NOMBRE de prestations
// documentées. Idem : aucune table contestation/renouvellement liée au contrat
// → on ne template que des faits à source réelle.

/** Jours civils entre deux dates `YYYY-MM-DD` (UTC-stable, indépendant TZ). */
function civilDayDiff(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  )
}

function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export type ContractExpiry =
  | { kind: 'none'; label: string }
  | { kind: 'expired'; endDate: string; days: number; label: string }
  | { kind: 'soon'; endDate: string; days: number; label: string } // ≤ 30 j
  | { kind: 'watch'; endDate: string; days: number; label: string } // ≤ 90 j
  | { kind: 'far'; endDate: string; days: number; label: string }

/**
 * Verdict d'échéance PUR (testable hors DB). Constat, jamais jugement :
 * aucun mot « risque », aucun score — le `kind` pilote l'emphase UI, le
 * `label` reste factuel.
 */
export function computeContractExpiry(
  endDate: string | null,
  today: string,
): ContractExpiry {
  if (!endDate) return { kind: 'none', label: 'Pas de date de fin renseignée.' }
  const days = civilDayDiff(today, endDate) // > 0 = échéance future
  if (days < 0) {
    const n = -days
    return { kind: 'expired', endDate, days: n, label: `Contrat échu depuis le ${frDate(endDate)} (${n} j).` }
  }
  const label = `Échéance le ${frDate(endDate)} — dans ${days} j.`
  if (days <= 30) return { kind: 'soon', endDate, days, label }
  if (days <= 90) return { kind: 'watch', endDate, days, label }
  return { kind: 'far', endDate, days, label }
}

/** Échéance d'un contrat (date civile Nouméa pour « aujourd'hui »). */
export async function getContractExpiry(contractId: string): Promise<ContractExpiry> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('end_date')
    .eq('id', contractId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return computeContractExpiry((data?.end_date as string | null) ?? null, todayLocalIso())
}

export interface ContractVitals {
  contractId: string
  /** Mois civil courant Nouméa, "YYYY-MM". */
  moisCourant: string
  /** Objectif déclaré du contrat (cible, jamais par personne). */
  volumeHoraireMensuelPrevu: number | null
  /** Prestations documentées (completed|validated) ce mois civil. */
  prestationsDocumenteesCeMois: number
  /** Total cumulé de prestations documentées. */
  prestationsDocumenteesCumul: number
}

/**
 * Vitalité du contrat : objectif déclaré vs prestations DOCUMENTÉES (compte,
 * pas heures fabriquées). Réutilise la chaîne contrat→sites→missions→
 * interventions déjà éprouvée (getContractContinuity).
 */
export async function getContractVitals(contractId: string): Promise<ContractVitals> {
  const supabase = createAdminClient()
  const moisCourant = todayLocalIso().slice(0, 7)

  const { data: contract } = await supabase
    .from('contracts')
    .select('volume_horaire_mensuel')
    .eq('id', contractId)
    .is('deleted_at', null)
    .maybeSingle()

  const base: ContractVitals = {
    contractId,
    moisCourant,
    volumeHoraireMensuelPrevu:
      (contract?.volume_horaire_mensuel as number | null | undefined) ?? null,
    prestationsDocumenteesCeMois: 0,
    prestationsDocumenteesCumul: 0,
  }

  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  const siteIds = (sites ?? []).map((s) => s.id as string)
  if (siteIds.length === 0) return base

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id as string)
  if (missionIds.length === 0) return base

  const { data: interventions } = await supabase
    .from('interventions')
    .select('executed_at')
    .in('mission_id', missionIds)
    .in('status', EXECUTED_STATUSES as unknown as string[])
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(5000)
  const rows = (interventions ?? []) as Array<{ executed_at: string }>

  base.prestationsDocumenteesCumul = rows.length
  base.prestationsDocumenteesCeMois = rows.filter(
    (r) => localDateOf(new Date(r.executed_at)).slice(0, 7) === moisCourant,
  ).length
  return base
}

/**
 * Mémoire du contrat : faits TEMPLATÉS déterministes assemblés de sources
 * réelles uniquement (continuité, prestations documentées, échéance). Aucune
 * narration générée (verrou ia-interdits), aucun score/%/tension (V6.4).
 */
export async function getContractMemory(
  contractId: string,
  role: UserRole | null = null,
): Promise<string[]> {
  const [continuity, vitals, expiry, linkedDocs] = await Promise.all([
    getContractContinuity(contractId),
    getContractVitals(contractId),
    getContractExpiry(contractId),
    listDocumentsForTarget('contract', contractId),
  ])

  const facts: string[] = []

  if (continuity && continuity.consecutiveMonthsWithIntervention > 0) {
    const m = continuity.consecutiveMonthsWithIntervention
    facts.push(`Service documenté ${m} mois consécutif${m > 1 ? 's' : ''}.`)
  }
  if (continuity && continuity.totalExecutedInterventions > 0) {
    facts.push(
      `${continuity.totalExecutedInterventions} prestation${continuity.totalExecutedInterventions > 1 ? 's' : ''} documentée${continuity.totalExecutedInterventions > 1 ? 's' : ''} au total.`,
    )
  }

  const objectif =
    vitals.volumeHoraireMensuelPrevu != null
      ? ` — objectif déclaré ${vitals.volumeHoraireMensuelPrevu} h/mois`
      : ''
  facts.push(
    `${vitals.prestationsDocumenteesCeMois} prestation${vitals.prestationsDocumenteesCeMois > 1 ? 's' : ''} documentée${vitals.prestationsDocumenteesCeMois > 1 ? 's' : ''} ce mois${objectif}.`,
  )

  if (expiry.kind !== 'none') facts.push(expiry.label)

  // A5 — fait documentaire FACTUEL et sobre (zéro IA/recall/score). Source
  // réelle = document_links. visibility_level respecté : sans rôle résolu
  // (role=null → canViewDocument false), aucun document visible → AUCUN
  // détail exposé (pas de fait). Aucun document admin_only ne fuite vers
  // un rôle non autorisé.
  const visibleDocs = linkedDocs.filter((d) =>
    canViewDocument(role, d.visibility_level),
  )
  if (visibleDocs.length > 0) {
    const n = visibleDocs.length
    // Types distincts, triés (déterministe), plafonnés (sobre).
    const types = [...new Set(visibleDocs.map((d) => d.document_type))]
      .sort()
      .slice(0, 6)
    facts.push(
      `${n} document${n > 1 ? 's' : ''} rattaché${n > 1 ? 's' : ''} à ce contrat : ${types.join(' · ')}.`,
    )
  }

  return facts
}
