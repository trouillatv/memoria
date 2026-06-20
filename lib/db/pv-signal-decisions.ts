// Décisions humaines sur les signaux de validation PV (mig 125). Les 3 verbes qui
// ne corrigent PAS la mémoire (≠ Compléter) mais doivent rester AUDITABLES :
//   reported       — « je ne sais pas encore » (différé ; reste bloquant)
//   ignored        — « on s'en fiche pour ce chantier » (renoncement assumé ; levé)
//   false_positive — « le détecteur s'est trompé » (retour détection ; levé)
// Une décision COURANTE par (report, signal) → upsert.
import { createAdminClient } from '@/lib/supabase/admin'

export type PvSignalStatut = 'reported' | 'ignored' | 'false_positive'

export interface PvSignalDecision {
  signalId: string
  statut: PvSignalStatut
  comment: string | null
  decidedAt: string
}

export async function listPvSignalDecisions(reportId: string): Promise<PvSignalDecision[]> {
  const { data } = await createAdminClient()
    .from('pv_signal_decisions')
    .select('signal_id, statut, comment, decided_at')
    .eq('report_id', reportId)
  return (data ?? []).map((r) => ({
    signalId: r.signal_id as string,
    statut: r.statut as PvSignalStatut,
    comment: (r.comment as string | null) ?? null,
    decidedAt: r.decided_at as string,
  }))
}

export async function upsertPvSignalDecision(input: {
  reportId: string
  signalId: string
  statut: PvSignalStatut
  comment?: string | null
  decidedBy?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('pv_signal_decisions')
    .upsert(
      {
        report_id: input.reportId,
        signal_id: input.signalId,
        statut: input.statut,
        comment: input.comment ?? null,
        decided_by: input.decidedBy ?? null,
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'report_id,signal_id' },
    )
  if (error) throw new Error(error.message)
}

/** Annule une décision (l'humain s'est ravisé) → le signal redevient actif. */
export async function clearPvSignalDecision(reportId: string, signalId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('pv_signal_decisions')
    .delete()
    .eq('report_id', reportId)
    .eq('signal_id', signalId)
  if (error) throw new Error(error.message)
}
