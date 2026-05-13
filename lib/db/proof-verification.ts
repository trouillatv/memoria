// Slice S3 — Token PERMANENT de vérification d'authenticité.
//
// Doctrine V5 Pilier 6 « Infrastructure invisible » :
//   Sylvie veut pouvoir archiver le PDF pour son dossier qualité et le
//   vérifier 3 ans plus tard. Les share_tokens expirent — les
//   verification_tokens jamais.

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ProofVerificationToken {
  id: string
  intervention_id: string | null
  contract_id: string | null
  report_month: string | null
  token: string
  tenant_name: string | null
  created_at: string
}

function generateToken(): string {
  return randomBytes(16).toString('hex') // 32 chars URL-safe
}

/**
 * Récupère ou crée un verification_token pour une intervention donnée.
 * Idempotent : si un token existe déjà pour cette intervention, on le réutilise.
 */
export async function ensureVerificationTokenForIntervention(input: {
  interventionId: string
  tenantName: string | null
  createdBy?: string | null
}): Promise<ProofVerificationToken> {
  const supabase = createAdminClient()

  // Lookup existing
  const { data: existing } = await supabase
    .from('proof_verification_tokens')
    .select('*')
    .eq('intervention_id', input.interventionId)
    .maybeSingle()
  if (existing) return existing as ProofVerificationToken

  // Create
  const token = generateToken()
  const { data, error } = await supabase
    .from('proof_verification_tokens')
    .insert({
      intervention_id: input.interventionId,
      token,
      tenant_name: input.tenantName,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ProofVerificationToken
}

/**
 * Récupère ou crée un verification_token pour un rapport mensuel donné.
 */
export async function ensureVerificationTokenForMonthlyReport(input: {
  contractId: string
  reportMonth: string
  tenantName: string | null
  createdBy?: string | null
}): Promise<ProofVerificationToken> {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('proof_verification_tokens')
    .select('*')
    .eq('contract_id', input.contractId)
    .eq('report_month', input.reportMonth)
    .maybeSingle()
  if (existing) return existing as ProofVerificationToken

  const token = generateToken()
  const { data, error } = await supabase
    .from('proof_verification_tokens')
    .insert({
      contract_id: input.contractId,
      report_month: input.reportMonth,
      token,
      tenant_name: input.tenantName,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ProofVerificationToken
}

/**
 * Lookup public — utilisé par la page /v/[token]. Pas d'auth requise.
 * Renvoie null si le token n'existe pas (document supprimé / token forgé).
 */
export async function getVerificationTokenByValue(
  token: string,
): Promise<ProofVerificationToken | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_verification_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  return (data as ProofVerificationToken | null) ?? null
}
