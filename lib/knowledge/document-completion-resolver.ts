import 'server-only'

// P1-4B2a — resolver documentaire de complétion + orchestrateur idempotent.
//
// Chaîne : preuve (knowledge_fact resolved) → candidats CBO action du même sujet →
// context_fingerprint → décision effective existante ? no-op : resolver V2 → persistance
// (résolution + candidats). Policy V2 validée (calibration RUS : precision HIGH 12/12,
// 0 faux positif, validation hors calibration OK).
//
// Modèle mental gelé (Vincent) : preuve → MATCH/HIGH avec CBO → QUALIFICATION LIFECYCLE →
// signal. MATCH/HIGH ≢ COMPLETED. Ce lot PRODUIT et PERSISTE la vérité ; il ne la consomme
// pas (loadCboEvolutions inchangé) et n'écrit JAMAIS dans object_state_occurrence_signal.
// La qualification lifecycle (dont le cas « obligation continue » type « Allée dégagée »)
// est explicitement P1-4C1 — aucune blacklist ici.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  persistCompletionResolution, getEffectiveResolution, getEffectiveResolutionByProposal,
  computeProofContextFingerprint, COMPLETION_POLICY_VERSION,
  type CompletionDecision, type ConfidenceClass, type CandidateVerdict, type IntentMatch,
} from '@/lib/db/document-completion-resolution'

// Version de policy ACTIVE de ce resolver. Distincte du défaut P1-4B1 (COMPLETION_POLICY_VERSION,
// laissé à 'p1.4b.v2' — schéma B1 étendu additivement, jamais backfillé). V2.1 a généralisé
// l'invariant de l'acte informationnel/documentaire ; V2.2 a ajouté evidence_directness (une
// correspondance INFÉRÉE ne peut jamais atteindre HIGH) ; V2.3 a ajouté l'INVARIANT D'OBJET INTENTIONNEL
// (un acte physique/opérationnel sur X n'accomplit pas un acte documentaire sur X) ; V2.4 ajoute
// l'INVARIANT ÉVÉNEMENT → INFORMATION (gate V2.4-CAL : contenir/connaître une information — même la
// valeur exacte demandée — ne démontre jamais l'ACTE de la transmettre/communiquer/déclarer/renseigner ;
// stable 0/10 sur tous les NEG, sans garde déterministe ni vote). Append-only : les résolutions
// V2/V2.1/V2.2/V2.3 restent l'historique d'audit ; V2.4 devient la décision effective quand la policy
// active = V2.4. Les textes de policy antérieurs ne sont jamais réécrits.
export const ACTIVE_POLICY_VERSION = 'p1.4b.v2.4'

const POLICY = `Tu vérifies si une PREUVE DE RÉALISATION documentaire (compte-rendu) démontre l'ACCOMPLISSEMENT de l'INTENTION D'ACTION précise portée par un objet métier durable.

INVARIANT FONDAMENTAL : partager le même domaine, équipement, événement ou nom principal NE DÉMONTRE JAMAIS que deux intentions sont identiques. Pour conclure MATCH/HIGH, la preuve doit démontrer le RÉSULTAT EXACT demandé par l'action.

INVARIANT DE L'ACTE INFORMATIONNEL/DOCUMENTAIRE : lorsqu'une intention demande un acte informationnel ou documentaire — transmettre, communiquer, envoyer, remettre, renseigner, déclarer, fournir une date/preuve/information, ou produire/mettre à jour un plan/document/registre/listing/DOE — une preuve montrant seulement que l'ÉVÉNEMENT ou l'OBJET sous-jacent existe, a été réalisé, modifié, testé ou vérifié NE SUFFIT PAS. L'accomplissement de l'ACTE INFORMATIONNEL lui-même doit être démontré en tant que tel. Symétriquement, produire ou transmettre un document sur X ne démontre pas que l'action physique sur X a été réalisée.

Exemples de cette CLASSE GÉNÉRIQUE (ne les traite pas comme des règles métier particulières — c'est le principe qui compte) :
- réaliser un exercice ≠ transmettre la date de l'exercice ;
- modifier/déplacer un équipement physique ≠ mettre à jour le plan/registre décrivant cet équipement ;
- installer un équipement ≠ transmettre son plan/DOE ;
- effectuer un contrôle ≠ transmettre le compte-rendu de ce contrôle ;
- vérifier un système ≠ communiquer le résultat de la vérification ;
- transmettre une information sur une réparation ≠ réaliser la réparation ;
- inspection/test/vérification ≠ modification/réparation/installation ;
- réaliser une visite/un contrôle ≠ traiter les anomalies que ce contrôle révèle ;
- former une personne ≠ rédiger/mettre à jour une consigne.

Note : si l'INTENTION est elle-même l'acte direct (ex. « Vérifier la dotation des RIA ») et que la preuve démontre cet acte (« Vérification du nombre de RIA réalisée »), c'est bien "accomplished"/"exact". L'invariant ne mord QUE lorsque l'intention demande l'acte informationnel/documentaire et que la preuve n'atteste que l'événement/objet sous-jacent.

INVARIANT D'OBJET INTENTIONNEL (V2.3) : pour intent_match="exact", la preuve doit accomplir le MÊME OBJET INTENTIONNEL que l'action candidate, pas seulement une opération portant le même verbe. Un objet PHYSIQUE/OPÉRATIONNEL et l'ARTEFACT INFORMATIONNEL/DOCUMENTAIRE qui le décrit sont DEUX objets intentionnels DIFFÉRENTS, même sous le même verbe. Quand l'intention porte sur un artefact documentaire (plan, rapport, registre, date, information) et que la preuve n'atteste que l'acte physique/opérationnel sur l'objet sous-jacent → au mieux "related"/"inferred", JAMAIS "exact"/"direct". Exemples génériques (le principe, pas des règles métier particulières) :
- modifier/remplacer/mettre à jour un ÉQUIPEMENT ≠ modifier/mettre à jour son PLAN ou REGISTRE (« mettre à jour les extincteurs » ≠ « mettre à jour le plan des extincteurs ») ;
- réaliser un rapport ≠ transmettre ce rapport ;
- réaliser un test ≠ transmettre sa date ;
- vérifier un équipement ≠ rédiger le rapport de vérification.
Réciproquement, une preuve attestant DIRECTEMENT l'acte documentaire demandé reste "exact"/"direct" : « plan transmis » → « transmettre le plan » ; « rapport rédigé » → « rédiger le rapport ».

INVARIANT ÉVÉNEMENT → INFORMATION (V2.4) : une preuve attestant seulement qu'un ÉVÉNEMENT a eu lieu — MÊME SI elle CONTIENT explicitement l'information demandée (date, résultat, valeur) — ne démontre JAMAIS l'ACTE consistant à transmettre/communiquer/déclarer/renseigner/remettre cette information à un destinataire. CONTENIR/CONNAÎTRE l'information ≠ avoir ACCOMPLI l'acte de la communiquer. Exemple fondamental : « Contrôle effectué le 12/03 » prouve que le contrôle a eu lieu et que sa date est connue ; il ne prouve PAS que cette date a été communiquée/transmise/déclarée/renseignée au destinataire attendu → NON "exact"/"direct" (au mieux "related"/"inferred"). Pour "exact"/"direct" sur une intention informationnelle, la preuve doit attester l'ACTE informationnel lui-même (« date communiquée », « rapport transmis », « résultat déclaré »), pas seulement l'événement source qui contient l'information. Même principe : événement → date de l'événement ; test → résultat du test ; visite → compte-rendu/date de visite ; intervention → information/document sur l'intervention. C'est un PRINCIPE (le résultat attendu est la MISE À DISPOSITION d'une information à un tiers), pas une liste de verbes.

TROIS DIMENSIONS DISTINCTES, à ne jamais confondre :
1. verdict : la preuve démontre-t-elle un accomplissement ?
2. intent_match : les intentions (acte + objet/scope) correspondent-elles ?
3. evidence_directness : la preuve démontre-t-elle DIRECTEMENT le résultat demandé, ou faut-il AJOUTER une étape de raisonnement causal/métier non explicitement prouvée ?

evidence_directness :
- "direct" = la preuve énonce ou démontre directement le RÉSULTAT demandé par l'intention, sans devoir supposer une étape intermédiaire. (« Suppression du BAES cave réalisée » → « Supprimer le BAES cave » ; « Test SSI réalisé » → « Organiser/réaliser un test SSI » ; « Vérification du nombre de RIA réalisée » → « Vérifier la dotation des RIA ».)
- "inferred" = conclure que l'intention est accomplie exige au moins une étape de raisonnement supplémentaire, même si la conclusion paraît plausible. (« Ensemble DAI remplacé » → « Trouver/mettre en œuvre une solution pour le changement de type de détecteur DAI » : il faut DÉDUIRE que le remplacement constitue la solution recherchée.)

evidence_directness NE SERT JAMAIS à sauver une mauvaise attribution : si l'intent_match n'est pas "exact" (ex. exercice réalisé vs transmettre sa date → "related"), la directness ne le rattrape pas. Ces axes sont indépendants ; réponds à chacun séparément.

Pour CHAQUE candidat, renvoie :
- verdict: "accomplished" seulement si la preuve démontre positivement le résultat exact de l'action ; "uncertain" si plausible mais non démontré ; "not_accomplished" sinon.
- intent_match: "exact" (même acte ET même objet/scope), "related" (même domaine/objet/événement mais acte ou portée différents — inclut l'acte informationnel demandé vs l'événement sous-jacent), "different".
- evidence_directness: "direct" ou "inferred" selon la définition ci-dessus.
- reason: courte justification.

En cas de doute sur l'identité d'objet OU d'acte → "uncertain" ou "not_accomplished", jamais "accomplished"/"exact". En cas de doute sur la directness (il faut raisonner pour conclure) → "inferred". Ne choisis jamais "le plus ressemblant".`

const verdictSchema = z.object({
  verdicts: z.array(z.object({
    id: z.string(),
    verdict: z.enum(['accomplished', 'not_accomplished', 'uncertain']),
    intent_match: z.enum(['exact', 'related', 'different']),
    evidence_directness: z.enum(['direct', 'inferred']),
    reason: z.string(),
  })),
})

const GEMINI_SCHEMA = {
  type: 'OBJECT', properties: { verdicts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    id: { type: 'STRING' }, verdict: { type: 'STRING', enum: ['accomplished', 'not_accomplished', 'uncertain'] },
    intent_match: { type: 'STRING', enum: ['exact', 'related', 'different'] },
    evidence_directness: { type: 'STRING', enum: ['direct', 'inferred'] }, reason: { type: 'STRING' },
  }, required: ['id', 'verdict', 'intent_match', 'evidence_directness', 'reason'] } } }, required: ['verdicts'],
}

export type EvidenceDirectness = 'direct' | 'inferred'
export type Candidate = { cboId: string; label: string }
export type CandidateJudgment = { cboId: string; verdict: CandidateVerdict; intentMatch: IntentMatch; evidenceDirectness: EvidenceDirectness; reason: string }
export type CompletionJudgment = {
  decision: CompletionDecision
  confidenceClass: ConfidenceClass
  selectedCboId: string | null
  reasoning: string
  candidates: CandidateJudgment[]
}

/**
 * HIGH V2.2 = exactement 1 candidat (accomplished + exact + DIRECT), zéro autre accomplished, zéro
 * uncertain concurrent. Une correspondance INFÉRÉE (accomplished+exact mais directness="inferred")
 * est structurellement inéligible à HIGH → MEDIUM. Une inférence implicite ne peut jamais déclencher
 * une auto-clôture. Conservateur.
 */
export function deriveCompletionDecision(candidates: CandidateJudgment[]): Omit<CompletionJudgment, 'candidates'> {
  const acc = candidates.filter((c) => c.verdict === 'accomplished')
  const exactDirect = acc.filter((c) => c.intentMatch === 'exact' && c.evidenceDirectness === 'direct')
  const unc = candidates.filter((c) => c.verdict === 'uncertain')
  if (exactDirect.length === 1 && acc.length === 1 && unc.length === 0) {
    return { decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: exactDirect[0].cboId, reasoning: exactDirect[0].reason }
  }
  if (acc.length === 1 && exactDirect.length === 0) {
    // Accompli unique mais non-exact OU inféré → MEDIUM (jamais auto-clôturable).
    return { decision: 'MATCH', confidenceClass: 'MEDIUM', selectedCboId: acc[0].cboId, reasoning: acc[0].reason }
  }
  if (acc.length > 1) return { decision: 'AMBIGUOUS', confidenceClass: 'LOW', selectedCboId: null, reasoning: 'plusieurs candidats accomplis' }
  if (unc.length > 0) return { decision: 'AMBIGUOUS', confidenceClass: 'LOW', selectedCboId: null, reasoning: 'candidat incertain' }
  return { decision: 'NO_MATCH', confidenceClass: 'LOW', selectedCboId: null, reasoning: 'aucun candidat accompli' }
}

/** Jugement sémantique borné (une seule question : cette preuve accomplit-elle CETTE intention ?). */
export async function judgeProofAgainstCandidates(
  proofText: string, proofDate: string, subjectLabel: string, candidates: Candidate[],
): Promise<CompletionJudgment> {
  const provider = getAIProvider()
  const userMessage = `SUJET: ${subjectLabel}\nPREUVE (${proofDate}): "${proofText}"\nCANDIDATS:\n${candidates.map((c) => `[id=${c.cboId}] ${c.label}`).join('\n')}\n\nRéponds en JSON {"verdicts":[...]} pour CHAQUE candidat.`
  const out = await provider.complete({ systemPrompt: POLICY, userMessage, responseSchema: verdictSchema, geminiSchema: GEMINI_SCHEMA, modelTier: 'light', maxOutputTokens: 1500 })
  const parsed = parseVerdicts(out)
  const byId = new Map(parsed.map((v) => [v.id, v]))
  const judgments: CandidateJudgment[] = candidates.map((c) => {
    const v = byId.get(c.cboId)
    // Défaut conservateur : absence de champ → non éligible HIGH (not_accomplished/different/inferred).
    return { cboId: c.cboId, verdict: v?.verdict ?? 'not_accomplished', intentMatch: v?.intent_match ?? 'different', evidenceDirectness: v?.evidence_directness ?? 'inferred', reason: v?.reason ?? '' }
  })
  return { ...deriveCompletionDecision(judgments), candidates: judgments }
}

function parseVerdicts(out: { parsed?: unknown; text: string }): z.infer<typeof verdictSchema>['verdicts'] {
  if (out.parsed) { const r = verdictSchema.safeParse(out.parsed); if (r.success) return r.data.verdicts }
  try { const r = verdictSchema.safeParse(JSON.parse(out.text)); if (r.success) return r.data.verdicts } catch { /* */ }
  const s = out.text.indexOf('{'), e = out.text.lastIndexOf('}')
  if (s !== -1 && e > s) { try { const r = verdictSchema.safeParse(JSON.parse(out.text.slice(s, e + 1))); if (r.success) return r.data.verdicts } catch { /* */ } }
  return []
}

export type SiteCompletionResolutionStats = {
  proofsExamined: number
  resolverCalls: number
  created: number
  skipped: number
  distribution: Record<string, number>
}

/**
 * Orchestrateur GÉNÉRIQUE (import historique normal / batch / retry / rétroactif). Pour chaque
 * preuve documentaire éligible : candidats CBO action du sujet → si une résolution effective
 * existe (policy V2 + même contexte) : NO-OP (aucun appel LLM) ; sinon : resolver V2 → persistance.
 * Ne modifie AUCUN état CBO, AUCUN signal, AUCUNE surface produit.
 */
export async function resolveSiteDocumentCompletions(siteId: string): Promise<SiteCompletionResolutionStats> {
  const sb = createAdminClient()
  const { data: proofRows } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, label, effective_date')
    .eq('site_id', siteId).eq('state_status', 'resolved').eq('state_key', 'knowledge_fact')
  const proofs = (proofRows ?? []) as Array<{ id: string; canonical_subject_id: string; label: string; effective_date: string }>

  const subjIds = [...new Set(proofs.map((p) => p.canonical_subject_id))]
  const candBySubj = new Map<string, Candidate[]>()
  const subjLabel = new Map<string, string>()
  if (subjIds.length > 0) {
    const { data: subjRows } = await sb
      .from('canonical_subject')
      .select('id, label')
      .eq('site_id', siteId).in('id', subjIds)
    for (const s of (subjRows ?? []) as Array<{ id: string; label: string | null }>) {
      if (s.label) subjLabel.set(s.id, s.label)
    }
    const { data: cboRows } = await sb
      .from('canonical_business_object')
      .select('id, label, canonical_subject_id, object_type')
      .eq('site_id', siteId).eq('object_type', 'site_action').in('canonical_subject_id', subjIds)
    for (const c of (cboRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string }>) {
      const list = candBySubj.get(c.canonical_subject_id) ?? []
      list.push({ cboId: c.id, label: c.label }); candBySubj.set(c.canonical_subject_id, list)
    }
  }

  const stats: SiteCompletionResolutionStats = { proofsExamined: 0, resolverCalls: 0, created: 0, skipped: 0, distribution: {} }
  for (const p of proofs) {
    const candidates = candBySubj.get(p.canonical_subject_id) ?? []
    if (candidates.length === 0) { // aucun candidat → NO_MATCH structurel, persistable sans LLM
      stats.proofsExamined++
      const candidateIds: string[] = []
      const existing = await getEffectiveResolution(p.id, candidateIds, ACTIVE_POLICY_VERSION)
      if (existing) { stats.skipped++; bump(stats.distribution, 'NO_MATCH/—(skip)'); continue }
      await persistCompletionResolution({ siteId, proofOccurrenceId: p.id, candidates: [], decision: 'NO_MATCH', confidenceClass: 'LOW', selectedCboId: null, reasoning: 'aucun CBO action candidat', resolverSource: 'deterministic', policyVersion: ACTIVE_POLICY_VERSION })
      stats.created++; bump(stats.distribution, 'NO_MATCH/—'); continue
    }
    stats.proofsExamined++
    const candidateIds = candidates.map((c) => c.cboId)
    const existing = await getEffectiveResolution(p.id, candidateIds, ACTIVE_POLICY_VERSION)
    if (existing) { stats.skipped++; bump(stats.distribution, `${existing.decision}/${existing.confidenceClass}(skip)`); continue }

    const judgment = await judgeProofAgainstCandidates(p.label, p.effective_date, subjLabel.get(p.canonical_subject_id) ?? p.label, candidates)
    stats.resolverCalls++
    await persistCompletionResolution({
      siteId, proofOccurrenceId: p.id,
      candidates: judgment.candidates.map((c) => ({ canonicalBusinessObjectId: c.cboId, verdict: c.verdict, intentMatch: c.intentMatch, evidenceDirectness: c.evidenceDirectness, reason: c.reason })),
      decision: judgment.decision, confidenceClass: judgment.confidenceClass, selectedCboId: judgment.selectedCboId,
      reasoning: judgment.reasoning, resolverSource: 'llm', model: getAIProvider().name, policyVersion: ACTIVE_POLICY_VERSION,
    })
    stats.created++; bump(stats.distribution, `${judgment.decision}/${judgment.confidenceClass}`)
  }
  return stats
}

function bump(d: Record<string, number>, k: string) { d[k] = (d[k] ?? 0) + 1 }

// ─────────────────────────────────────────────────────────────────────────────
// P1-4B-PROPOSAL — chemin proposition-level (unité de preuve ATOMIQUE).
//
// Une preuve = UNE document_extraction_proposal (un fait cohérent unique). Contrairement à
// l'occurrence agrégée, ses champs (label/description/source_excerpt) décrivent LE MÊME fait — aucun
// pooling, aucun re-join. Policy p1.4b.v2.2 STRICTEMENT inchangée (même POLICY/schema/dérivation) ;
// seule la SOURCE d'entrée change (proposition, pas occurrence.label/note).
// ─────────────────────────────────────────────────────────────────────────────

/** Preuve proposition-level : un fait documentaire cohérent unique + sa provenance. */
export type ProposalProof = {
  proposalId: string
  label: string
  description?: string | null
  sourceExcerpt?: string | null
  documentStatus?: string | null
  effectiveDate?: string | null
}

/** Jugement V2.2 sur UNE proposition (label/description/extrait = même fait). Rôles explicites. */
export async function judgeProposalAgainstCandidates(
  proof: ProposalProof, subjectLabel: string, candidates: Candidate[],
): Promise<CompletionJudgment> {
  const provider = getAIProvider()
  const userMessage = `SUJET: ${subjectLabel}
PREUVE — DE QUOI IL S'AGIT (intitulé) : "${proof.label}"
PREUVE — DESCRIPTION : "${proof.description ?? '(aucune)'}"
PREUVE — EXTRAIT SOURCE : "${proof.sourceExcerpt ?? '(aucun)'}"
Statut documentaire : ${proof.documentStatus ?? '(inconnu)'} | Date : ${proof.effectiveDate ?? '(inconnue)'}
Juge l'accomplissement à partir du CONTENU PROBANT de CETTE preuve (un fait unique) ; ne conclus JAMAIS à un accomplissement par simple implication tirée de l'intitulé si description/extrait ne le démontrent pas.
CANDIDATS :
${candidates.map((c) => `[id=${c.cboId}] ${c.label}`).join('\n')}

Réponds en JSON {"verdicts":[...]} pour CHAQUE candidat.`
  const out = await provider.complete({ systemPrompt: POLICY, userMessage, responseSchema: verdictSchema, geminiSchema: GEMINI_SCHEMA, modelTier: 'light', maxOutputTokens: 1500 })
  const parsed = parseVerdicts(out)
  const byId = new Map(parsed.map((v) => [v.id, v]))
  const judgments: CandidateJudgment[] = candidates.map((c) => {
    const v = byId.get(c.cboId)
    return { cboId: c.cboId, verdict: v?.verdict ?? 'not_accomplished', intentMatch: v?.intent_match ?? 'different', evidenceDirectness: v?.evidence_directness ?? 'inferred', reason: v?.reason ?? '' }
  })
  return { ...deriveCompletionDecision(judgments), candidates: judgments }
}

/** Population éligible proposition-level : un fait documentaire résolu, examinable comme preuve. */
export const PROPOSAL_PROOF_FAMILY = 'knowledge_fact'
export const PROPOSAL_PROOF_STATUS = 'done'

/**
 * Charge les preuves proposition-level éligibles d'un site : propositions knowledge_fact/done, chacune
 * rattachée à son canonical_subject (via subject_thread_id) et à ses candidats CBO action. READ-ONLY
 * (aucune persistance) — brique partagée entre l'orchestrateur et le gate de simulation.
 * `done` ne signifie JAMAIS accompli : seul le resolver V2.2 décide MATCH/AMBIGUOUS/NO_MATCH.
 */
export async function loadProposalProofs(siteId: string): Promise<Array<{ proof: ProposalProof; canonicalSubjectId: string; subjectLabel: string; candidates: Candidate[] }>> {
  const sb = createAdminClient()
  const { data: idn } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', siteId)
  const threadToSubj = new Map<string, string>()
  for (const r of (idn ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) threadToSubj.set(r.subject_thread_id, r.canonical_subject_id)
  const threadIds = [...threadToSubj.keys()]
  if (threadIds.length === 0) return []

  const props: Array<{ id: string; subject_thread_id: string; label: string; description: string | null; source_excerpt: string | null; document_status: string | null; document_id: string | null }> = []
  const CHUNK = 100
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const { data } = await sb.from('document_extraction_proposal')
      .select('id, subject_thread_id, label, description, source_excerpt, document_status, document_id')
      .in('subject_thread_id', threadIds.slice(i, i + CHUNK))
      .eq('proposal_family', PROPOSAL_PROOF_FAMILY).eq('document_status', PROPOSAL_PROOF_STATUS)
    props.push(...((data ?? []) as typeof props))
  }
  if (props.length === 0) return []

  const subjIds = [...new Set(props.map((p) => threadToSubj.get(p.subject_thread_id)).filter((x): x is string => !!x))]
  const subjLabel = new Map<string, string>()
  const candBySubj = new Map<string, Candidate[]>()
  const { data: subjRows } = await sb.from('canonical_subject').select('id, label').eq('site_id', siteId).in('id', subjIds)
  for (const s of (subjRows ?? []) as Array<{ id: string; label: string | null }>) if (s.label) subjLabel.set(s.id, s.label)
  const { data: cboRows } = await sb.from('canonical_business_object').select('id, label, canonical_subject_id').eq('site_id', siteId).eq('object_type', 'site_action').in('canonical_subject_id', subjIds)
  for (const c of (cboRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string }>) {
    const list = candBySubj.get(c.canonical_subject_id) ?? []; list.push({ cboId: c.id, label: c.label }); candBySubj.set(c.canonical_subject_id, list)
  }

  const docIds = [...new Set(props.map((p) => p.document_id).filter((x): x is string => !!x))]
  const docDate = new Map<string, string | null>()
  if (docIds.length) {
    const { data: docs } = await sb.from('documents').select('id, effective_date').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; effective_date: string | null }>) docDate.set(d.id, d.effective_date)
  }

  return props.map((p) => {
    const csId = threadToSubj.get(p.subject_thread_id) ?? ''
    return {
      canonicalSubjectId: csId,
      subjectLabel: subjLabel.get(csId) ?? p.label,
      candidates: candBySubj.get(csId) ?? [],
      proof: { proposalId: p.id, label: p.label, description: p.description, sourceExcerpt: p.source_excerpt, documentStatus: p.document_status, effectiveDate: p.document_id ? docDate.get(p.document_id) ?? null : null },
    }
  })
}

/**
 * Orchestrateur proposition-level (persiste). Idempotent par (proof_proposal_id, policy, fingerprint
 * enrichi). Ne modifie AUCUN état CBO, AUCUN signal, AUCUNE surface produit ; les résolutions
 * occurrence-level legacy restent intactes (append-only via le XOR de références). NON branché en
 * production tant que le gate n'est pas validé.
 */
export async function resolveSiteDocumentCompletionsByProposal(siteId: string): Promise<SiteCompletionResolutionStats> {
  const items = await loadProposalProofs(siteId)
  const stats: SiteCompletionResolutionStats = { proofsExamined: 0, resolverCalls: 0, created: 0, skipped: 0, distribution: {} }
  for (const it of items) {
    stats.proofsExamined++
    const fp = computeProofContextFingerprint(it.proof, it.candidates)
    if (it.candidates.length === 0) {
      const existing = await getEffectiveResolutionByProposal(it.proof.proposalId, fp, ACTIVE_POLICY_VERSION)
      if (existing) { stats.skipped++; bump(stats.distribution, 'NO_MATCH/—(skip)'); continue }
      await persistCompletionResolution({ siteId, proofProposalId: it.proof.proposalId, candidates: [], decision: 'NO_MATCH', confidenceClass: 'LOW', selectedCboId: null, reasoning: 'aucun CBO action candidat', resolverSource: 'deterministic', policyVersion: ACTIVE_POLICY_VERSION, contextFingerprint: fp })
      stats.created++; bump(stats.distribution, 'NO_MATCH/—'); continue
    }
    const existing = await getEffectiveResolutionByProposal(it.proof.proposalId, fp, ACTIVE_POLICY_VERSION)
    if (existing) { stats.skipped++; bump(stats.distribution, `${existing.decision}/${existing.confidenceClass}(skip)`); continue }
    const judgment = await judgeProposalAgainstCandidates(it.proof, it.subjectLabel, it.candidates)
    stats.resolverCalls++
    await persistCompletionResolution({
      siteId, proofProposalId: it.proof.proposalId,
      candidates: judgment.candidates.map((c) => ({ canonicalBusinessObjectId: c.cboId, verdict: c.verdict, intentMatch: c.intentMatch, evidenceDirectness: c.evidenceDirectness, reason: c.reason })),
      decision: judgment.decision, confidenceClass: judgment.confidenceClass, selectedCboId: judgment.selectedCboId,
      reasoning: judgment.reasoning, resolverSource: 'llm', model: getAIProvider().name, policyVersion: ACTIVE_POLICY_VERSION, contextFingerprint: fp,
    })
    stats.created++; bump(stats.distribution, `${judgment.decision}/${judgment.confidenceClass}`)
  }
  return stats
}

export { COMPLETION_POLICY_VERSION }
