import 'server-only'

// « Ce que MemorIA a retenu » — la COUCHE PARTAGÉE du résumé de visite.
//
// Le moteur (runVisitDebriefAgent, 2 agents) est INCHANGÉ : aucune nouvelle IA,
// aucun nouveau prompt. On ajoute seulement la PERSISTANCE et le cache :
//   - lazy-once : l'analyse ne tourne qu'à la demande (première ouverture du
//     débrief), jamais depuis un worker qui ignore ce que fait l'utilisateur ;
//   - cache : le résultat est rangé dans site_reports.debrief_analysis (mig 211)
//     et REJOUÉ tel quel — le LLM n'est jamais rappelé à chaque affichage ;
//   - corpus_hash : hash de la MATIÈRE de la visite (transcript, notes, captures
//     triées, actions/réserves, pièces) en ordre stable. Si Guillaume corrige la
//     transcription ou ajoute un élément, le hash diffère → l'analyse est
//     régénérée. On EXCLUT le contexte site volatile (signaux/historique/sujets)
//     du hash : sinon la moindre activité ailleurs invaliderait le cache et
//     relancerait le LLM sans que la visite ait changé ;
//   - verrou (debrief_generating_at) : deux ouvertures simultanées ne lancent pas
//     deux fois le LLM — la seconde voit « en cours » et attend.
//
// ⚠️ SÉCURITÉ : cette couche utilise le service-role (bypasse la RLS). Elle est
// auth-agnostique par conception : CHAQUE appelant (action mobile/desktop) DOIT
// avoir vérifié, fail-closed, l'organisation + l'accès au chantier AVANT de lui
// passer un reportId. Cf. isolation-tenants-fail-closed.
//
// ⚠️ Les `actions` stockées ici sont des PROPOSITIONS IA — jamais des site_actions.
// Seule la validation humaine crée de vraies actions ; régénérer remplace les
// propositions mais ne touche JAMAIS les actions déjà validées.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { gatherVisitDebriefContext } from '@/lib/db/visits'
import { runVisitDebriefAgent, type VisitDebriefInput, type VisitDebriefParsed } from '@/services/ai/visit-debrief'

type Confidence = 'elevee' | 'moyenne' | 'faible' | null

/** Un bail de génération plus vieux que ça est considéré comme abandonné. */
const LEASE_MS = 120_000

export interface StoredDebriefAnalysis {
  summary: string
  decisions: string[]
  // ✅ Actions = cartes : quoi + pourquoi + priorité + responsable + échéance.
  actions: Array<{
    title: string
    rationale: string
    priority: 'haute' | 'moyenne' | 'basse' | null
    owner: string
    due: string
  }>
  // ⚠️ Points de vigilance = fiches : le risque + impact + responsable + échéance.
  watchpoints: Array<{ label: string; impact: string; owner: string; due: string }>
  // ℹ️ Contexte important mais non actionnable.
  a_savoir: string[]
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
  corpus_hash: string
}

/** L'entrée EXACTE passée à l'agent — construite une seule fois, hashée, puis
 *  envoyée telle quelle : le hash décrit précisément ce qui a été analysé. */
function buildDebriefInput(
  ctx: NonNullable<Awaited<ReturnType<typeof gatherVisitDebriefContext>>>,
  userId: string | null,
): VisitDebriefInput {
  const signalLines = ctx.signals.flatMap((s) => [
    s.title,
    ...s.items.slice(0, 4).map((i) => `  • ${i.label}${i.context && i.context.length > 0 ? ` (${i.context[0]})` : ''}`),
  ])
  return {
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
  }
}

/** Empreinte de la MATIÈRE PROPRE À LA VISITE, en ordre stable (voir en-tête sur
 *  l'exclusion du contexte site volatile). */
export function computeCorpusHash(input: VisitDebriefInput): string {
  const corpus = JSON.stringify({
    objectiveHint: input.objectiveHint ?? '',
    transcript: input.transcript ?? '',
    capturedText: input.capturedText ?? '',
    capturedNotes: input.capturedNotes,
    attachmentNames: input.attachmentNames,
    capturedActions: input.capturedActions,
    capturedReserves: input.capturedReserves,
  })
  return createHash('sha256').update(corpus).digest('hex')
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
    decisions: parsed.decisions,
    actions: parsed.suggested_actions,
    watchpoints: parsed.important_points,
    a_savoir: parsed.a_savoir,
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
    corpus_hash: hash,
  }
}

async function readState(
  reportId: string,
): Promise<{ analysis: StoredDebriefAnalysis | null; generatingAt: string | null }> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('debrief_analysis, debrief_generating_at')
    .eq('id', reportId)
    .maybeSingle()
  const row = data as { debrief_analysis: StoredDebriefAnalysis | null; debrief_generating_at: string | null } | null
  return { analysis: row?.debrief_analysis ?? null, generatingAt: row?.debrief_generating_at ?? null }
}

async function setLease(reportId: string): Promise<void> {
  await createAdminClient()
    .from('site_reports')
    .update({ debrief_generating_at: new Date().toISOString() })
    .eq('id', reportId)
}

async function writeAnalysis(reportId: string, analysis: StoredDebriefAnalysis): Promise<void> {
  await createAdminClient()
    .from('site_reports')
    .update({ debrief_analysis: analysis, debrief_generating_at: null })
    .eq('id', reportId)
}

async function clearLease(reportId: string): Promise<void> {
  await createAdminClient().from('site_reports').update({ debrief_generating_at: null }).eq('id', reportId)
}

export interface LoadedDebrief {
  analysis: StoredDebriefAnalysis
  openSubjects: Array<{ id: string; name: string }>
  /** true = rejoué depuis le cache (aucun appel LLM) ; false = fraîchement analysé. */
  fromCache: boolean
}

export type DebriefLoadResult =
  | { ok: true; status: 'ready'; loaded: LoadedDebrief }
  | { ok: true; status: 'generating' } // un autre appel analyse déjà — réessayer bientôt
  | { ok: false; error: string }

const leaseFresh = (iso: string | null): boolean => !!iso && Date.now() - Date.parse(iso) < LEASE_MS

/**
 * Lazy-once + cache + verrou. Renvoie l'analyse persistée si son corpus_hash colle
 * à la matière actuelle ; sinon lance le moteur (une seule fois, verrouillé),
 * persiste, renvoie. `force` régénère toujours (« Régénérer », jamais automatique).
 *
 * L'appelant DOIT avoir vérifié l'organisation + l'accès chantier au préalable.
 */
export async function loadOrRunVisitDebrief(
  reportId: string,
  userId: string | null,
  opts?: { force?: boolean },
): Promise<DebriefLoadResult> {
  const ctx = await gatherVisitDebriefContext(reportId)
  if (!ctx) return { ok: false, error: 'Visite introuvable' }
  const input = buildDebriefInput(ctx, userId)
  const hash = computeCorpusHash(input)

  const state = await readState(reportId)
  if (!opts?.force && state.analysis && state.analysis.corpus_hash === hash) {
    return { ok: true, status: 'ready', loaded: { analysis: state.analysis, openSubjects: ctx.openSubjects, fromCache: true } }
  }
  // Quelqu'un d'autre analyse déjà (bail frais) : on ne double pas l'appel.
  if (leaseFresh(state.generatingAt)) return { ok: true, status: 'generating' }

  await setLease(reportId)
  // Double-vérification juste avant l'appel coûteux : un autre appel a pu finir.
  if (!opts?.force) {
    const again = await readState(reportId)
    if (again.analysis && again.analysis.corpus_hash === hash) {
      await clearLease(reportId)
      return { ok: true, status: 'ready', loaded: { analysis: again.analysis, openSubjects: ctx.openSubjects, fromCache: true } }
    }
  }

  try {
    const res = await runVisitDebriefAgent(input)
    const analysis = fromAgent(res.narrative, res.parsed, res.provider, res.model, hash)
    await writeAnalysis(reportId, analysis).catch(() => {})
    return { ok: true, status: 'ready', loaded: { analysis, openSubjects: ctx.openSubjects, fromCache: false } }
  } catch {
    await clearLease(reportId).catch(() => {})
    return { ok: false, error: "L'analyse IA a échoué" }
  }
}
