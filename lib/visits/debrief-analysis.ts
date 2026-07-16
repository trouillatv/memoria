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
import { gatherVisitDebriefContext, type VisitSourceSnapshot } from '@/lib/db/visits'
import { computeSnapshotDelta, type SnapshotDelta } from '@/lib/visits/source-snapshot'
import { runVisitDebriefAgent, type VisitDebriefInput, type VisitDebriefParsed } from '@/services/ai/visit-debrief'
import { projectDebriefToProposals } from '@/lib/db/knowledge-proposals'

type Confidence = 'elevee' | 'moyenne' | 'faible' | null

/** Un bail de génération plus vieux que ça est considéré comme abandonné. */
const LEASE_MS = 120_000

/** Une échéance telle que le débrief la donne : ce qui doit arriver, et la notion
 *  de temps qui l'accompagne — une date si elle est dite, sinon la contrainte. */
export interface DebriefEcheance {
  label: string
  /** AAAA-MM-JJ, ou '' : une date DITE, jamais déduite d'un délai. */
  date: string
  /** « Avant le démarrage », « Sous une dizaine de jours ». '' si une date est nette. */
  constraint: string
}

/** Les analyses écrites AVANT la forme structurée stockaient des chaînes nues.
 *  On les relit sans jamais les jeter : une vieille échéance devient un label sans
 *  date ni contrainte — exactement ce qu'elle disait, ni plus, ni moins. */
export function toDebriefEcheance(raw: unknown): DebriefEcheance | null {
  if (typeof raw === 'string') {
    const label = raw.trim()
    return label ? { label, date: '', constraint: '' } : null
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { label?: unknown; date?: unknown; constraint?: unknown }
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!label) return null
    return {
      label,
      date: typeof o.date === 'string' ? o.date.trim() : '',
      constraint: typeof o.constraint === 'string' ? o.constraint.trim() : '',
    }
  }
  return null
}

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
  // 📅 Échéances — CE QUI doit arriver, et QUAND si on le sait.
  //   · `date` = une vraie date (AAAA-MM-JJ), ou '' si le débrief n'en donne pas.
  //   · `constraint` = la contrainte dite (« Avant le démarrage », « Sous dix jours »).
  // Une échéance n'existe que s'il y a une notion de temps ; sans elle, c'est une
  // action. Et un délai n'est JAMAIS converti en date : MemorIA ne devine pas une
  // information qu'elle ne possède pas — l'humain tranche.
  echeances: DebriefEcheance[]
  intervenants: string[]
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
  /** Version de FORME (régénération silencieuse si périmée). */
  schema_version: string
  /** N° de synthèse : +1 à chaque « Mettre à jour ». L'humain voit qu'elle évolue. */
  analysis_version: number
  /** Ce qui a été pris en compte — pour dire « synthèse à jour » vs « enrichie depuis ». */
  source_snapshot: VisitSourceSnapshot
  /** Grand livre des actions : accumule à travers les mises à jour, jamais effacé. */
  action_ledger: LedgerAction[]
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

// Version de FORME de l'analyse stockée. À incrémenter dès que la STRUCTURE de
// StoredDebriefAnalysis change : un cache d'une forme périmée est régénéré en
// SILENCE (pas « enrichi »). Distinct du corpus_hash, qui ne décrit QUE la matière.
// v6 : les échéances deviennent { label, date, constraint }. Le bump fait régénérer
// les analyses de forme v5 à leur prochaine ouverture — c'est le mécanisme prévu.
const ANALYSIS_SCHEMA_VERSION = 'v6-echeances-datees'

/** Empreinte de la MATIÈRE PROPRE À LA VISITE (le CORPUS envoyé à l'agent), en
 *  ordre stable. NE dépend PAS de la version de forme : un corpus inchangé donne le
 *  même hash → « synthèse à jour » ; un ajout (note, mémo, commentaire) le change →
 *  « visite enrichie depuis ». On exclut le contexte site volatile (voir en-tête). */
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

// ── Actions VIVANTES (grand livre) ───────────────────────────────────────────
// Les actions ne sont pas jetées à chaque synthèse. L'IA PROPOSE, l'humain
// décide (fait / écarté), et une mise à jour AJOUTE les nouvelles propositions
// sans jamais effacer les anciennes ni ressusciter une proposition écartée.
export type ActionState = 'open' | 'done' | 'dismissed'
export interface LedgerAction {
  key: string
  title: string
  rationale: string
  priority: 'haute' | 'moyenne' | 'basse' | null
  owner: string
  due: string
  state: ActionState
  /** N° de synthèse où l'action est APPARUE — pour signaler « Nouveau ». */
  version_added: number
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
/** Clé STABLE d'une action (titre normalisé) : reconnaît une proposition déjà vue,
 *  même reformulée légèrement, pour ne pas la re-proposer. */
export function actionKey(title: string): string {
  return createHash('sha1').update(normalizeTitle(title)).digest('hex').slice(0, 16)
}

/** Fusion PRÉSERVANTE : garde tout l'existant (états humains intacts), met à jour
 *  le texte d'une proposition revue, ajoute les nouvelles en 'open'. N'efface jamais. */
function mergeActionLedger(
  old: LedgerAction[] | undefined,
  proposals: VisitDebriefParsed['suggested_actions'],
  version: number,
): LedgerAction[] {
  const result: LedgerAction[] = (old ?? []).map((a) => ({ ...a }))
  const byKey = new Map(result.map((a) => [a.key, a]))
  for (const p of proposals) {
    const key = actionKey(p.title)
    const existing = byKey.get(key)
    if (existing) {
      // Proposition déjà connue : on rafraîchit le texte, on PRÉSERVE l'état humain.
      existing.title = p.title; existing.rationale = p.rationale
      existing.priority = p.priority; existing.owner = p.owner; existing.due = p.due
    } else {
      const entry: LedgerAction = {
        key, title: p.title, rationale: p.rationale, priority: p.priority,
        owner: p.owner, due: p.due, state: 'open', version_added: version,
      }
      result.push(entry); byKey.set(key, entry)
    }
  }
  return result
}

function fromAgent(
  narrative: string,
  parsed: VisitDebriefParsed,
  provider: string,
  model: string | null,
  hash: string,
  version: number,
  snapshot: VisitSourceSnapshot,
  oldLedger: LedgerAction[] | undefined,
): StoredDebriefAnalysis {
  return {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    analysis_version: version,
    source_snapshot: snapshot,
    action_ledger: mergeActionLedger(oldLedger, parsed.suggested_actions, version),
    summary: narrative,
    decisions: parsed.decisions,
    actions: parsed.suggested_actions,
    watchpoints: parsed.important_points,
    a_savoir: parsed.a_savoir,
    echeances: parsed.echeances,
    intervenants: parsed.intervenants,
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

/**
 * Projette la synthèse en propositions métier, et LAISSE UNE TRACE (mig 213).
 *
 * La projection n'est PAS un « best effort » : c'est un élément métier. Si elle
 * échoue, la connaissance de la visite (actions, échéances, intervenants, savoirs)
 * n'apparaît nulle part et le chantier paraît VIDE — l'utilisateur conclut que
 * MemorIA n'a rien compris, alors qu'il avait compris. Un échec silencieux est
 * donc le pire scénario possible.
 *
 * Cette fonction ne relance pas d'exception : un échec de projection ne doit pas
 * détruire une synthèse coûteuse déjà produite. Mais il est LOGGUÉ et PERSISTÉ —
 * les écrans peuvent le dire, et le diagnostic ne dépend plus d'une intuition.
 */
async function projectAndTrace(params: {
  reportId: string
  siteId: string
  organizationId: string
  analysis: StoredDebriefAnalysis
}): Promise<void> {
  const { reportId } = params
  try {
    await projectDebriefToProposals(params)
    await createAdminClient()
      .from('site_reports')
      .update({ debrief_projected_at: new Date().toISOString(), debrief_projection_error: null })
      .eq('id', reportId)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.error(`[debrief] projection en échec pour la visite ${reportId} : ${reason}`)
    await createAdminClient()
      .from('site_reports')
      .update({ debrief_projection_error: reason })
      .eq('id', reportId)
      // Si même la trace ne peut pas s'écrire, le log ci-dessus reste la preuve.
      .then(undefined, () => {})
  }
}

export interface LoadedDebrief {
  analysis: StoredDebriefAnalysis
  openSubjects: Array<{ id: string; name: string }>
  /** true = rejoué depuis le cache (aucun appel LLM) ; false = fraîchement analysé. */
  fromCache: boolean
}

/** Ce qui a été AJOUTÉ à la visite depuis la dernière synthèse (jamais négatif).
 *  Défini dans lib/visits/source-snapshot — ré-exporté ici pour les appelants du débrief. */
export type { SnapshotDelta } from '@/lib/visits/source-snapshot'

export type DebriefLoadResult =
  | { ok: true; status: 'ready'; loaded: LoadedDebrief } // synthèse à jour (ou fraîchement générée)
  | { ok: true; status: 'stale'; loaded: LoadedDebrief; delta: SnapshotDelta } // visite enrichie depuis
  | { ok: true; status: 'generating' } // un autre appel analyse déjà — réessayer bientôt
  | { ok: false; error: string }

const leaseFresh = (iso: string | null): boolean => !!iso && Date.now() - Date.parse(iso) < LEASE_MS

// La règle « qu'est-ce qui a été ajouté depuis ? » vit dans lib/visits/source-snapshot :
// le read model de la fiche chantier la partage, pour que les deux écrans ne puissent
// jamais dire deux choses différentes de la même synthèse.

/**
 * Synthèse VERSIONNÉE. La visite est la vérité ; la synthèse en est une lecture
 * horodatée. On ne régénère JAMAIS en silence pour une source qui a changé :
 *   - schéma périmé  → régénère silencieusement (forme incompatible) ;
 *   - corpus inchangé → `ready` (« synthèse à jour ») ;
 *   - source changée sans `force` → `stale` : on GARDE l'ancienne synthèse et on
 *     renvoie le delta (« visite enrichie depuis, +1 note… ») pour proposer la mise
 *     à jour. Rien de coché par l'humain n'est perdu ;
 *   - `force` (« Mettre à jour la synthèse ») → régénère, analysis_version + 1.
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
  const snapshot = ctx.sourceSnapshot

  const state = await readState(reportId)
  const cache = state.analysis
  const usable = cache && cache.schema_version === ANALYSIS_SCHEMA_VERSION

  if (usable && !opts?.force) {
    const loaded = { analysis: cache, openSubjects: ctx.openSubjects, fromCache: true }
    // Corpus inchangé → à jour.
    if (cache.corpus_hash === hash) return { ok: true, status: 'ready', loaded }
    // La visite a été enrichie depuis : on GARDE la synthèse, on signale le delta.
    return { ok: true, status: 'stale', loaded, delta: computeSnapshotDelta(cache.source_snapshot, snapshot) }
  }

  // (Re)génération : pas de cache utilisable, schéma périmé, ou mise à jour demandée.
  if (leaseFresh(state.generatingAt)) return { ok: true, status: 'generating' }
  await setLease(reportId)
  // Double-vérification (concurrence sur une PREMIÈRE génération) : un autre appel a pu finir.
  if (!opts?.force) {
    const again = await readState(reportId)
    if (again.analysis && again.analysis.schema_version === ANALYSIS_SCHEMA_VERSION && again.analysis.corpus_hash === hash) {
      await clearLease(reportId)
      return { ok: true, status: 'ready', loaded: { analysis: again.analysis, openSubjects: ctx.openSubjects, fromCache: true } }
    }
  }

  try {
    const res = await runVisitDebriefAgent(input)
    const version = (cache?.analysis_version ?? 0) + 1
    // Le grand livre d'actions du cache (même schéma périmé) est REPRIS : une mise
    // à jour n'efface jamais un état humain (fait/écarté).
    const oldLedger = cache?.schema_version === ANALYSIS_SCHEMA_VERSION ? cache.action_ledger : undefined
    const analysis = fromAgent(res.narrative, res.parsed, res.provider, res.model, hash, version, snapshot, oldLedger)
    await writeAnalysis(reportId, analysis).catch(() => {})
    // Couche d'extraction métier : la synthèse fraîche est projetée en propositions
    // (actions, vigilances, décisions, savoirs, intervenants, échéances), visibles
    // partout et distinctes des objets validés. Idempotent → pas de doublon aux
    // mises à jour. Un échec est TRACÉ (mig 213), jamais avalé : sans projection,
    // la connaissance de la visite n'apparaît nulle part.
    if (ctx.visit.site_id && ctx.visit.organization_id) {
      await projectAndTrace({
        reportId,
        siteId: ctx.visit.site_id,
        organizationId: ctx.visit.organization_id,
        analysis,
      })
    }
    return { ok: true, status: 'ready', loaded: { analysis, openSubjects: ctx.openSubjects, fromCache: false } }
  } catch {
    await clearLease(reportId).catch(() => {})
    return { ok: false, error: "L'analyse IA a échoué" }
  }
}

/**
 * Change l'état d'UNE action du grand livre (fait / écarté / rouverte). N'appelle
 * jamais le LLM : lecture-modification-écriture du JSONB. Ne régénère rien — c'est
 * une décision HUMAINE sur une proposition, préservée aux prochaines synthèses.
 * L'appelant DOIT avoir vérifié l'organisation.
 */
export async function setActionState(reportId: string, key: string, state: ActionState): Promise<boolean> {
  const { analysis } = await readState(reportId)
  if (!analysis || !Array.isArray(analysis.action_ledger)) return false
  const entry = analysis.action_ledger.find((a) => a.key === key)
  if (!entry) return false
  entry.state = state
  await writeAnalysis(reportId, analysis)
  return true
}

/**
 * Lecture SEULE de l'analyse stockée (aucun LLM, aucune régénération), suivie d'une
 * projection IDEMPOTENTE en propositions métier : GARANTIT que les propositions
 * d'action existent pour la synthèse actuellement affichée (une analyse en cache
 * d'avant la couche d'extraction n'avait encore rien projeté — sinon « Créer
 * l'action » n'aurait aucune proposition à promouvoir). Renvoie le grand livre des
 * actions non écartées (clé + titre + responsable + échéance). L'appelant DOIT
 * avoir vérifié l'organisation avant d'appeler (service-role → RLS bypassée).
 */
export async function ensureActionProposalsProjected(
  reportId: string,
  siteId: string,
  organizationId: string | null,
): Promise<Array<{ key: string; title: string; owner: string; due: string }>> {
  const { analysis } = await readState(reportId)
  if (!analysis) return []
  if (organizationId) {
    await projectAndTrace({ reportId, siteId, organizationId, analysis })
  }
  return (analysis.action_ledger ?? [])
    .filter((a) => a.state !== 'dismissed')
    .map((a) => ({ key: a.key, title: a.title, owner: a.owner, due: a.due }))
}
