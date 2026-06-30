// lib/db/comprehension.ts
// Persistance du harnais d'évaluation de la compréhension IA (mig 179).
//
// Les FAITS donnés à l'IA sont assemblés depuis le read-model (lensTender) — un
// seul contrat, le même que les écrans lisent (parité auditable : l'IA ne voit
// rien de plus que l'humain). L'IA rend des affirmations atomiques ; on stocke
// run + affirmations ; l'humain note chaque affirmation (grille 4 classes).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { TenderReading } from '@/lib/db/dossier-readings'
import type { ResolvedQuestion } from '@/lib/db/previsite-synthesis'
import type { ComprehensionAffirmation } from '@/services/ai/comprehension'

export type AffirmationVerdict = 'juste' | 'vague' | 'parasite' | 'dangereux'
// Niveau 2 — test de transmission : « pourrais-tu transmettre l'affaire avec ça ? »
export type GlobalVerdict = 'transmissible' | 'corrections' | 'incomplet' | 'trompeur'

export interface ComprehensionAffirmationRow {
  id: string
  ordinal: number
  category: string
  text: string
  provenance: string[]
  verdict: AffirmationVerdict | null
  verdict_note: string | null
}

export interface ComprehensionRunView {
  id: string
  createdAt: string
  model: string | null
  globalVerdict: GlobalVerdict | null
  missingNote: string | null
  affirmations: ComprehensionAffirmationRow[]
}

/** Palmarès FACTUEL (pas un score) : sur combien de vraies prévisites l'IA a été
 *  évaluée, et par combien de conducteurs. Argument commercial = « construite sur
 *  le terrain », jamais sortie d'un prompt. Scopé org. */
export interface ComprehensionTrackRecord {
  evaluatedRuns: number
  conductors: number
}

/**
 * Assemble les FAITS numérotés que l'IA va lire, depuis le read-model + les
 * points déjà vérifiés. Fonction PURE : c'est exactement la matière des écrans,
 * mise à plat. L'IA citera ces faits par leur index (provenance).
 */
export function buildComprehensionFacts(r: TenderReading, resolved: ResolvedQuestion[]): string[] {
  const facts: string[] = []
  const o = r.observed
  facts.push(`Observations : ${o.photos} photo(s), ${o.videos} vidéo(s), ${o.vocals.length} vocal(aux), ${o.notes.length} note(s), ${o.verifications} vérification(s).`)
  for (const it of r.starred) facts.push(`Marqué important (⭐) : ${it.text}`)
  for (const q of resolved) facts.push(`Vérifié : ${q.question} → ${q.answer?.trim() ? q.answer.trim() : 'confirmé'}`)
  for (const n of o.notes) facts.push(`Note terrain : ${n.text}`)
  for (const v of o.vocals) facts.push(`Vocal (transcrit) : « ${v.text} »`)
  for (const q of r.questions) facts.push(`À vérifier (non résolu) : ${q.text}`)
  for (const it of r.promises) facts.push(`Engagement entendu : ${it.text}`)
  for (const it of r.risks) facts.push(`Risque de chiffrage signalé : ${it.text}`)
  for (const it of r.pitfalls) facts.push(`Piège / contrainte du lieu : ${it.text}`)
  for (const it of r.missingDocuments) facts.push(`Document manquant / attendu : ${it.text}`)
  for (const d of r.toWatch) facts.push(`Point à creuser : ${d.name}${d.openQuestion ? ` — ${d.openQuestion}` : d.cause ? ` — ${d.cause}` : ''}`)
  return facts
}

/** Crée un run de compréhension (instantané) + ses affirmations. Retourne l'id du run. */
export async function createComprehensionRun(input: {
  dossierId: string
  siteId: string | null
  provider: string
  model: string | null
  createdBy: string | null
  affirmations: ComprehensionAffirmation[]
}): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId().catch(() => null)

  const { data: run, error } = await supabase
    .from('comprehension_runs')
    .insert({
      organization_id: orgId,
      dossier_id: input.dossierId,
      site_id: input.siteId,
      provider: input.provider,
      model: input.model,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  const runId = (run as { id: string }).id

  if (input.affirmations.length > 0) {
    const rows = input.affirmations.map((a, i) => ({
      run_id: runId,
      organization_id: orgId,
      ordinal: i,
      category: a.category,
      text: a.text.slice(0, 1000),
      provenance: a.provenance,
    }))
    const { error: insErr } = await supabase.from('comprehension_affirmations').insert(rows)
    if (insErr) throw insErr
  }
  return runId
}

/** Le dernier run d'un dossier, avec ses affirmations (ordre du rendu). */
export async function getLatestComprehensionRun(dossierId: string): Promise<ComprehensionRunView | null> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('comprehension_runs')
    .select('id, created_at, model, global_verdict, missing_note')
    .eq('dossier_id', dossierId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const r = run as { id: string; created_at: string; model: string | null; global_verdict: GlobalVerdict | null; missing_note: string | null } | null
  if (!r) return null

  const { data: affs } = await supabase
    .from('comprehension_affirmations')
    .select('id, ordinal, category, text, provenance, verdict, verdict_note')
    .eq('run_id', r.id)
    .order('ordinal', { ascending: true })

  return {
    id: r.id,
    createdAt: r.created_at,
    model: r.model,
    globalVerdict: r.global_verdict,
    missingNote: r.missing_note,
    affirmations: ((affs ?? []) as Array<{
      id: string; ordinal: number; category: string; text: string
      provenance: string[] | null; verdict: AffirmationVerdict | null; verdict_note: string | null
    }>).map((a) => ({
      id: a.id,
      ordinal: a.ordinal,
      category: a.category,
      text: a.text,
      provenance: Array.isArray(a.provenance) ? a.provenance : [],
      verdict: a.verdict,
      verdict_note: a.verdict_note,
    })),
  }
}

/** Enregistre (ou efface) le verdict humain d'une affirmation. */
export async function setAffirmationVerdict(
  id: string,
  verdict: AffirmationVerdict | null,
  note: string | null,
  userId: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('comprehension_affirmations')
    .update({
      verdict,
      verdict_note: note,
      verdict_by: verdict ? userId : null,
      verdict_at: verdict ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
}

/** Niveau 2 — verdict GLOBAL de transmission d'un run (toggle : null efface). */
export async function setRunGlobalVerdict(
  runId: string,
  verdict: GlobalVerdict | null,
  userId: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('comprehension_runs')
    .update({
      global_verdict: verdict,
      global_verdict_by: verdict ? userId : null,
      global_verdict_at: verdict ? new Date().toISOString() : null,
    })
    .eq('id', runId)
  if (error) throw error
}

/** « Il manque quelque chose » — note libre des OMISSIONS de l'IA (découvre ses biais). */
export async function setRunMissingNote(runId: string, note: string | null): Promise<void> {
  const supabase = createAdminClient()
  const trimmed = note?.trim() || null
  const { error } = await supabase
    .from('comprehension_runs')
    .update({ missing_note: trimmed })
    .eq('id', runId)
  if (error) throw error
}

/** Palmarès factuel de l'org : nb de prévisites où la compréhension a été évaluée
 *  (verdict global posé) + nb de conducteurs distincts. Pas un score : un compteur. */
export async function getComprehensionTrackRecord(orgId: string | null): Promise<ComprehensionTrackRecord> {
  if (!orgId) return { evaluatedRuns: 0, conductors: 0 }
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('comprehension_runs')
    .select('global_verdict_by')
    .eq('organization_id', orgId)
    .not('global_verdict', 'is', null)
  const rows = (data ?? []) as Array<{ global_verdict_by: string | null }>
  const conductors = new Set(rows.map((r) => r.global_verdict_by).filter((x): x is string => !!x))
  return { evaluatedRuns: rows.length, conductors: conductors.size }
}
