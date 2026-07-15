import 'server-only'

// « Ce que MemorIA a retenu » — la COUCHE PARTAGÉE du résumé de visite.
//
// Le moteur (runVisitDebriefAgent, 2 agents) est INCHANGÉ : aucune nouvelle IA,
// aucun nouveau prompt. On ajoute seulement la PERSISTANCE et le cache :
//   - lazy-once : l'analyse ne tourne qu'à la demande (première ouverture du
//     débrief), jamais depuis un worker qui ignore ce que fait l'utilisateur ;
//   - cache : le résultat est rangé dans site_reports.debrief_analysis (mig 211)
//     et REJOUÉ tel quel — le LLM n'est jamais rappelé à chaque affichage ;
//   - transcript_hash : si la transcription change, le hash diffère → le cache
//     est périmé et l'analyse est régénérée proprement.
//
// Auth-agnostique : mobile (field) et desktop (manager) l'appellent tous deux via
// une action mince qui porte l'autorisation.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { gatherVisitDebriefContext } from '@/lib/db/visits'
import { runVisitDebriefAgent, type VisitDebriefParsed } from '@/services/ai/visit-debrief'

type Confidence = 'elevee' | 'moyenne' | 'faible' | null

/**
 * Ce qui est rangé sur la visite. Le sommet (summary/decisions/actions/
 * watchpoints) EST « Ce que MemorIA a retenu » ; les champs de contexte servent
 * à la validation desktop (objectif/sujet/résultat). `decisions` est vide tant
 * que le prompt d'extraction ne les produit pas — la section n'apparaît alors
 * pas ; le jour où le moteur les extrait, elles s'afficheront sans rien changer.
 */
export interface StoredDebriefAnalysis {
  summary: string
  decisions: string[]
  actions: Array<{ title: string; rationale: string }>
  watchpoints: string[]
  attention: string[]
  open_questions: string[]
  forgotten_obligations: string[]
  objective: string
  objective_rationale: string
  objective_confidence: Confidence
  subject_match_index: number
  subject_name: string
  subject_rationale: string
  subject_confidence: Confidence
  outcome: string | null
  resolution: string | null
  provider: string
  model: string | null
  generated_at: string
  transcript_hash: string
}

/** Le cache est périmé si CE hash change. Guillaume corrige un mot → régénéré. */
export function computeTranscriptHash(transcript: string | null): string {
  return createHash('sha256').update(transcript ?? '').digest('hex')
}

function fromAgent(
  narrative: string,
  parsed: VisitDebriefParsed,
  provider: string,
  model: string | null,
  hash: string,
): StoredDebriefAnalysis {
  return {
    summary: narrative,
    decisions: [], // pas encore produit par le moteur — section masquée si vide
    actions: parsed.suggested_actions,
    watchpoints: parsed.important_points,
    attention: parsed.attention,
    open_questions: parsed.open_questions,
    forgotten_obligations: parsed.forgotten_obligations,
    objective: parsed.objective,
    objective_rationale: parsed.objective_rationale,
    objective_confidence: parsed.objective_confidence,
    subject_match_index: parsed.subject_match_index,
    subject_name: parsed.subject_name,
    subject_rationale: parsed.subject_rationale,
    subject_confidence: parsed.subject_confidence,
    outcome: parsed.outcome,
    resolution: parsed.resolution,
    provider,
    model,
    generated_at: new Date().toISOString(),
    transcript_hash: hash,
  }
}

async function readStored(reportId: string): Promise<StoredDebriefAnalysis | null> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('debrief_analysis')
    .eq('id', reportId)
    .maybeSingle()
  const raw = (data as { debrief_analysis: StoredDebriefAnalysis | null } | null)?.debrief_analysis
  return raw ?? null
}

async function writeStored(reportId: string, analysis: StoredDebriefAnalysis): Promise<void> {
  await createAdminClient().from('site_reports').update({ debrief_analysis: analysis }).eq('id', reportId)
}

export interface LoadedDebrief {
  analysis: StoredDebriefAnalysis
  openSubjects: Array<{ id: string; name: string }>
  /** true = rejoué depuis le cache (aucun appel LLM) ; false = fraîchement analysé. */
  fromCache: boolean
}

/**
 * Lazy-once + cache. Renvoie l'analyse persistée si son transcript_hash colle au
 * transcript actuel ; sinon lance le moteur, persiste, renvoie. `force` régénère
 * toujours (bouton « Régénérer », caché — jamais automatique).
 */
export async function loadOrRunVisitDebrief(
  reportId: string,
  userId: string | null,
  opts?: { force?: boolean },
): Promise<{ ok: true; loaded: LoadedDebrief } | { ok: false; error: string }> {
  const ctx = await gatherVisitDebriefContext(reportId)
  if (!ctx) return { ok: false, error: 'Visite introuvable' }
  const hash = computeTranscriptHash(ctx.transcript)

  if (!opts?.force) {
    const stored = await readStored(reportId)
    if (stored && stored.transcript_hash === hash) {
      return { ok: true, loaded: { analysis: stored, openSubjects: ctx.openSubjects, fromCache: true } }
    }
  }

  const signalLines = ctx.signals.flatMap((s) => [
    s.title,
    ...s.items.slice(0, 4).map((i) => `  • ${i.label}${i.context && i.context.length > 0 ? ` (${i.context[0]})` : ''}`),
  ])

  try {
    const res = await runVisitDebriefAgent({
      objectiveHint: ctx.visit.objective,
      capturedText: ctx.capturedText,
      transcript: ctx.transcript,
      attachmentNames: ctx.attachmentNames,
      capturedNotes: ctx.capturedNotes,
      capturedActions: ctx.capturedActions,
      capturedReserves: ctx.capturedReserves,
      signalLines,
      openSubjects: ctx.openSubjects,
      siteHistory: ctx.history,
      subjectDigests: ctx.subjectDigests,
      userId,
    })
    const analysis = fromAgent(res.narrative, res.parsed, res.provider, res.model, hash)
    // Best-effort : même si l'écriture échoue, l'utilisateur voit son résumé.
    await writeStored(reportId, analysis).catch(() => {})
    return { ok: true, loaded: { analysis, openSubjects: ctx.openSubjects, fromCache: false } }
  } catch {
    return { ok: false, error: "L'analyse IA a échoué" }
  }
}
