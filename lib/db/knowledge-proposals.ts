// lib/db/knowledge-proposals.ts
// Couche d'extraction métier (migration 212).
//
// La synthèse de visite (site_reports.debrief_analysis) ne reste plus enfermée
// dans son JSON : elle PROJETTE ce qu'elle a compris dans une table générique de
// PROPOSITIONS, visibles partout, distinctes des objets validés. L'humain promeut
// ensuite chaque proposition vers l'objet métier réel par un geste explicite.
//
// Règle produit : « L'IA fait apparaître ce qui mérite l'attention ; l'humain
// décide ce qui devient vrai dans le système. »
//
// Ce module fait DEUX choses (le reste — promotion, surfaces — vit ailleurs) :
//   1. projeter une synthèse en propositions, de façon IDEMPOTENTE ;
//   2. lister / compter les propositions d'un chantier.

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSiteAction } from '@/lib/db/site-actions'
import { createSiteDeadline } from '@/lib/db/site-deadlines'
import { createSiteDecision } from '@/lib/db/site-decisions'
import { createKnowledgeEntry, createWatchpoint, isChoosableKnowledgeKind } from '@/lib/db/site-memory-entries'
import { openSiteIntervenant } from '@/lib/db/site-intervenants'
import { findOrCreateCompanyByName, findOrCreateCompanyContact } from '@/lib/db/companies'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { findInLedger, recordPromotionInLedger } from '@/lib/db/concretisation-ledger'
// Le pont de vocabulaire entre les deux portes : « deadline » (proposition) et
// « echeance » (compte-rendu) désignent la même famille, et doivent porter la
// même signature — sans quoi le rapprochement échouerait silencieusement.
import { canonicalFamily, signatureOf } from '@/lib/visits/cr-concretisation'
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'
import { toDebriefEcheance } from '@/lib/visits/echeance-labels'

export type ProposalKind = 'action' | 'vigilance' | 'decision' | 'knowledge' | 'stakeholder' | 'deadline'
/**
 * `confirmed` et `fulfilled` disent tous deux « un objet du chantier existe pour
 * cette proposition », et se distinguent par QUI l'a décidé :
 *   · `confirmed` — un humain a tranché CETTE proposition (promotion). Il pose
 *     `reviewed_by` : la décision a un auteur.
 *   · `fulfilled` — l'objet est né de la concrétisation du compte-rendu corrigé.
 *     La proposition est satisfaite sans avoir jamais été jugée en tant que
 *     telle. Les confondre ferait dire au système qu'un arbitrage a eu lieu là
 *     où il n'y en a pas eu.
 * Aucun des deux n'attend plus de geste : ni l'un ni l'autre n'est du « travail
 * restant ». (mig 231)
 */
export type ProposalStatus = 'proposed' | 'confirmed' | 'fulfilled' | 'dismissed' | 'superseded'
export type ProposalPayload = Record<string, unknown>

export interface DbKnowledgeProposal {
  id: string
  organization_id: string
  site_id: string
  report_id: string | null
  analysis_version: number
  kind: ProposalKind
  status: ProposalStatus
  title: string
  body: string | null
  payload: ProposalPayload
  confidence: string | null
  source_capture_ids: string[]
  dedupe_key: string
  promoted_object_type: string | null
  promoted_object_id: string | null
  superseded_by: string | null
  dismiss_reason: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
}

/** Une proposition telle que dérivée de la synthèse (avant persistance). */
interface DesiredProposal {
  kind: ProposalKind
  title: string
  body: string | null
  payload: ProposalPayload
  dedupe_key: string
}

// ── Normalisation & déduplication ───────────────────────────────
// La clé NE dépend PAS que du titre : chaque type a ses éléments discriminants,
// pour qu'une re-synthèse ne duplique pas et ne ressuscite pas une proposition
// déjà écartée/confirmée.

function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function dedupeKey(kind: ProposalKind, siteId: string, parts: string[]): string {
  const basis = [kind, siteId, ...parts.map(normalize)].join('|')
  return createHash('sha1').update(basis).digest('hex').slice(0, 20)
}

// ── Dérivation : synthèse → propositions souhaitées ─────────────

function buildDesiredProposals(analysis: StoredDebriefAnalysis, siteId: string): DesiredProposal[] {
  const out: DesiredProposal[] = []
  const push = (kind: ProposalKind, title: string, body: string | null, payload: ProposalPayload, keyParts: string[]) => {
    const t = (title ?? '').trim()
    if (!t) return
    out.push({ kind, title: t, body: body?.trim() || null, payload, dedupe_key: dedupeKey(kind, siteId, keyParts) })
  }

  // Actions — grand livre (non écartées) ; repli sur analysis.actions pour les
  // anciennes synthèses sans grand livre. Discriminants : titre + owner + due.
  const ledger = (analysis.action_ledger ?? []).filter((a) => a.state !== 'dismissed')
  if (ledger.length > 0) {
    for (const a of ledger) {
      push('action', a.title, a.rationale, { priority: a.priority, owner: a.owner, due: a.due }, [a.title, a.owner, a.due])
    }
  } else {
    for (const a of analysis.actions ?? []) {
      push('action', a.title, a.rationale, { priority: a.priority, owner: a.owner, due: a.due }, [a.title, a.owner, a.due])
    }
  }

  // Vigilances — fiches. Discriminant : le libellé du risque.
  for (const w of analysis.watchpoints ?? []) {
    push('vigilance', w.label, w.impact, { impact: w.impact, owner: w.owner, due: w.due }, [w.label])
  }

  // Décisions — chaînes. Discriminant : le fait décidé.
  for (const d of analysis.decisions ?? []) {
    push('decision', d, null, {}, [d])
  }

  // Connaissances durables (« à savoir »). Discriminant : le fait normalisé.
  for (const k of analysis.a_savoir ?? []) {
    push('knowledge', k, null, {}, [k])
  }

  // Intervenants détectés. Discriminant : le nom/entité normalisé.
  for (const p of analysis.intervenants ?? []) {
    push('stakeholder', p, null, {}, [p])
  }

  // Échéances détectées. Le TITRE est ce qui doit arriver (« Poser le coffret ») ;
  // la notion de temps vit dans le payload — une date DITE, ou la contrainte telle
  // qu'elle a été formulée. Discriminants : le label + le moment, pour qu'une même
  // échéance replanifiée ne se dédouble pas.
  for (const raw of analysis.echeances ?? []) {
    const e = toDebriefEcheance(raw)
    if (!e) continue
    push('deadline', e.label, e.constraint || null, { date: e.date, constraint: e.constraint }, [e.label, e.date, e.constraint])
  }

  return out
}

// ── Projection idempotente ──────────────────────────────────────

export interface ProjectResult {
  inserted: number
  refreshed: number
  skipped: number
  /** Propositions d'une lecture antérieure que la synthèse ne dit plus. */
  obsolete: number
}

/**
 * Projette une synthèse en propositions, de façon IDEMPOTENTE :
 *   • proposition nouvelle           → insérée en 'proposed' ;
 *   • déjà présente et 'proposed'     → texte/priorité rafraîchis (la synthèse a
 *                                       pu reformuler) ;
 *   • déjà confirmée / écartée / remplacée → laissée INTACTE (une décision
 *                                       humaine ne se ressuscite jamais).
 * Rien n'est effacé : l'IA ajoute et met à jour, l'humain reste maître.
 */
export async function projectDebriefToProposals(params: {
  reportId: string
  siteId: string
  organizationId: string
  analysis: StoredDebriefAnalysis
}): Promise<ProjectResult> {
  const { reportId, siteId, organizationId, analysis } = params
  const desired = buildDesiredProposals(analysis, siteId)
  if (desired.length === 0) return { inserted: 0, refreshed: 0, skipped: 0, obsolete: 0 }

  const supabase = createAdminClient()
  const version = analysis.analysis_version ?? 1
  const now = new Date().toISOString()

  const keys = desired.map((d) => d.dedupe_key)
  const { data: existingRows, error: readErr } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key, status')
    .eq('site_id', siteId)
    .in('dedupe_key', keys)
  if (readErr) throw readErr
  const byKey = new Map(
    (existingRows ?? []).map((r) => [r.dedupe_key as string, r as { id: string; dedupe_key: string; status: ProposalStatus }]),
  )

  const toInsert: Array<Record<string, unknown>> = []
  let refreshed = 0
  let skipped = 0

  for (const d of desired) {
    const ex = byKey.get(d.dedupe_key)
    if (!ex) {
      toInsert.push({
        organization_id: organizationId,
        site_id: siteId,
        report_id: reportId,
        analysis_version: version,
        kind: d.kind,
        status: 'proposed',
        title: d.title,
        body: d.body,
        payload: d.payload,
        dedupe_key: d.dedupe_key,
      })
      continue
    }
    if (ex.status === 'proposed') {
      const { error: updErr } = await supabase
        .from('site_knowledge_proposals')
        .update({ title: d.title, body: d.body, payload: d.payload, analysis_version: version, updated_at: now })
        .eq('id', ex.id)
      if (updErr) throw updErr
      refreshed++
    } else {
      skipped++
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('site_knowledge_proposals').insert(toInsert)
    if (insErr) throw insErr
  }

  const obsolete = await markObsoleteProposals(reportId, version, new Set(keys), now)

  // De nouvelles propositions (ou des textes rafraîchis) → la connaissance « à
  // confirmer » du chantier change : la mutation invalide la projection.
  if (toInsert.length > 0 || refreshed > 0 || obsolete > 0) invalidateSiteProjection(siteId)

  return { inserted: toInsert.length, refreshed, skipped, obsolete }
}

// ── Obsolescence ────────────────────────────────────────────────
// LA RÈGLE (Vincent, 2026-07-17), valable pour TOUS les objets — actions,
// échéances, vigilances, intervenants, connaissances :
//
//   La visite est la vérité. La synthèse est une LECTURE de cette vérité. Une
//   nouvelle lecture rend l'ancienne obsolète — et ses propositions avec elle.
//
// « Poser le coffret » puis « Poser le coffret — sous dix jours » : ce n'est pas un
// doublon, c'est la même chose dite mieux. L'ancienne devient OBSOLÈTE.
//
// Pourquoi pas « écartée » : « écartée » veut dire « Guillaume n'est pas d'accord ».
// Ici il n'a rien décidé — c'est MemorIA qui s'est améliorée. Confondre les deux,
// c'est mettre dans la bouche du conducteur un refus qu'il n'a jamais prononcé.
//
// On ne touche QUE les 'proposed' : une décision humaine (confirmée / écartée) ne
// se réécrit jamais. Et seulement celles d'une lecture ANTÉRIEURE : une proposition
// que la synthèse courante redit vient d'être rafraîchie, elle est vivante.
//
// `superseded_by` reste NULL : on sait que la nouvelle lecture ne dit plus ce fait ;
// on ne sait pas LEQUEL des nouveaux le remplace. Le deviner par ressemblance de
// titre serait inventer un lien — la même faute que déduire une date d'un délai.
async function markObsoleteProposals(
  reportId: string,
  version: number,
  desiredKeys: Set<string>,
  now: string,
): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key')
    .eq('report_id', reportId)
    .eq('status', 'proposed')
    .lt('analysis_version', version)
  if (error || !data) return 0

  const stale = (data as Array<{ id: string; dedupe_key: string }>)
    .filter((r) => !desiredKeys.has(r.dedupe_key))
    .map((r) => r.id)
  if (stale.length === 0) return 0

  const { error: updErr } = await supabase
    .from('site_knowledge_proposals')
    .update({ status: 'superseded', updated_at: now })
    .in('id', stale)
  if (updErr) return 0
  return stale.length
}

// ── Lecture / comptage (pour les surfaces) ──────────────────────

export async function listProposalsBySite(
  siteId: string,
  opts?: { kind?: ProposalKind; status?: ProposalStatus | ProposalStatus[] },
): Promise<DbKnowledgeProposal[]> {
  const supabase = createAdminClient()
  let q = supabase.from('site_knowledge_proposals').select('*').eq('site_id', siteId)
  if (opts?.kind) q = q.eq('kind', opts.kind)
  if (opts?.status) {
    q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status)
  }
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbKnowledgeProposal[]
}

/** Compte les propositions d'un statut donné, par type — pour les compteurs
 *  « 3 actions proposées · 3 vigilances à confirmer » des surfaces. */
export async function countProposalsBySite(
  siteId: string,
  status: ProposalStatus = 'proposed',
): Promise<Record<ProposalKind, number>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('kind')
    .eq('site_id', siteId)
    .eq('status', status)
  if (error) throw error
  const counts: Record<ProposalKind, number> = {
    action: 0, vigilance: 0, decision: 0, knowledge: 0, stakeholder: 0, deadline: 0,
  }
  for (const r of data ?? []) counts[(r as { kind: ProposalKind }).kind]++
  return counts
}

// ── Décisions humaines : promouvoir / écarter ───────────────────
// « L'humain décide ce qui devient vrai. » Confirmer = PROMOUVOIR la proposition
// vers son objet métier réel (et la marquer 'confirmed', sans la détruire). Écarter
// = 'dismissed' (elle ne réapparaîtra jamais à une re-synthèse — la dédup la reconnaît).

/** Écarte une proposition : décision humaine, jamais ressuscitée. `organizationId`
 *  = garde fail-closed (le service-role bypasse la RLS) : on n'écarte que dans son org. */
export async function dismissProposal(
  id: string,
  reviewedBy: string | null,
  reason?: string,
  organizationId?: string | null,
): Promise<boolean> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  let q = supabase
    .from('site_knowledge_proposals')
    .update({ status: 'dismissed', reviewed_at: now, reviewed_by: reviewedBy, dismiss_reason: reason ?? null, updated_at: now })
    .eq('id', id)
    .eq('status', 'proposed') // on n'écarte que ce qui est encore proposé
  if (organizationId) q = q.eq('organization_id', organizationId)
  const { data, error } = await q.select('site_id')
  if (error) throw error
  // Une proposition écartée disparaît des « à confirmer » : la mutation invalide.
  const siteId = (data as Array<{ site_id: string }> | null)?.[0]?.site_id
  if (siteId) invalidateSiteProjection(siteId)
  return true
}

/**
 * Correspondance ledger → proposition (côté serveur) : pour une liste d'actions du
 * grand livre (titre + responsable + échéance), recalcule le `dedupe_key` — IDENTIQUE
 * à celui de la projection — et renvoie l'état de la proposition d'action associée,
 * indexé par la clé du ledger (`key`). Permet à la synthèse de savoir, pour chaque
 * action affichée, si elle est encore proposée / confirmée (promue) / écartée.
 */
/**
 * État des propositions d'ÉCHÉANCE de la synthèse, indexé par le label de l'échéance.
 * Mêmes parts de clé que `buildDesiredProposals` : label + date + contrainte — sinon
 * l'écran chercherait une proposition qui n'existe pas sous cette forme.
 */
export async function getDeadlineProposalStates(
  siteId: string,
  echeances: Array<{ label: string; date: string; constraint: string }>,
): Promise<Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }>> {
  const out: Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }> = {}
  if (echeances.length === 0) return out
  const labelByDedupe = new Map<string, string>()
  for (const e of echeances) {
    labelByDedupe.set(dedupeKey('deadline', siteId, [e.label, e.date, e.constraint]), e.label)
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key, status, promoted_object_type, promoted_object_id')
    .eq('site_id', siteId)
    .eq('kind', 'deadline')
    .in('dedupe_key', Array.from(labelByDedupe.keys()))
  if (error) return out
  for (const r of data ?? []) {
    const row = r as { id: string; dedupe_key: string; status: ProposalStatus; promoted_object_type: string | null; promoted_object_id: string | null }
    const label = labelByDedupe.get(row.dedupe_key)
    if (label) {
      out[label] = { proposalId: row.id, status: row.status, promotedObjectType: row.promoted_object_type, promotedObjectId: row.promoted_object_id }
    }
  }
  return out
}

export async function getActionProposalStates(
  siteId: string,
  actions: Array<{ key: string; title: string; owner?: string | null; due?: string | null }>,
): Promise<Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }>> {
  const out: Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }> = {}
  if (actions.length === 0) return out
  // dedupe_key → clé ledger (mêmes parts que buildDesiredProposals : titre, owner, due).
  const ledgerByDedupe = new Map<string, string>()
  for (const a of actions) {
    ledgerByDedupe.set(dedupeKey('action', siteId, [a.title, a.owner ?? '', a.due ?? '']), a.key)
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key, status, promoted_object_type, promoted_object_id')
    .eq('site_id', siteId)
    .eq('kind', 'action')
    .in('dedupe_key', Array.from(ledgerByDedupe.keys()))
  if (error) throw error
  for (const r of data ?? []) {
    const row = r as { id: string; dedupe_key: string; status: ProposalStatus; promoted_object_type: string | null; promoted_object_id: string | null }
    const ledgerKey = ledgerByDedupe.get(row.dedupe_key)
    if (ledgerKey) {
      out[ledgerKey] = { proposalId: row.id, status: row.status, promotedObjectType: row.promoted_object_type, promotedObjectId: row.promoted_object_id }
    }
  }
  return out
}

export interface PromotionResult { objectType: string; objectId: string }

/**
 * L'ISSUE d'une promotion. `needs_input` n'est PAS une erreur : c'est un état
 * métier PRÉVU. Le rôle d'un intervenant et la nature d'une information ne sont
 * pas des pannes — ce sont des questions que le système DOIT poser, parce que la
 * proposition ne les porte pas et que les deviner fabriquerait un fait.
 * Les traiter en exception forcerait chaque appelant à rattraper un throw pour
 * afficher... un sélecteur. L'attendu ne se lève pas, il se retourne.
 */
export type PromotionOutcome =
  | { status: 'promoted'; objectType: string; objectId: string }
  | { status: 'needs_input'; missing: PromotionInputName[] }
  | { status: 'unsupported'; kind: string }
  | { status: 'not_found' }

/**
 * CE QU'ON PEUT FAIRE D'UNE PROPOSITION — la source unique de vérité de l'UI.
 *
 * L'écran ne décide plus, il DEMANDE : « que puis-je faire avec cet objet ? ».
 * Une seule fonction répond. Auparavant la réponse était éparpillée en quatre
 * (canPromote / promotionLabel / promotionNeedsRole / whyNotPromotable) qui
 * racontaient toutes la même chose — et qu'un écran pouvait consulter à moitié.
 *
 * C'est la leçon du bug d'origine : promoteProposal ne gérait que 2 types sur 6,
 * et rien n'empêchait un bouton d'exister pour les 4 autres. Ici, un type sans
 * geste porte son explication ; il ne peut pas être promouvable ET inexpliqué.
 */
export type PromotionInputName = 'role' | 'nature' | 'company'

export interface PromotionCapability {
  /** Y a-t-il un geste métier réel derrière ? */
  available: boolean
  /** Le verbe du conducteur — « Créer l'action ». Jamais « Confirmer » nu. */
  label: string | null
  /** Ce que l'humain doit fournir : la proposition ne le porte pas. */
  requiredInputs: PromotionInputName[]
  /** Pourquoi c'est impossible. Renseigné UNIQUEMENT si `available` est faux. */
  explanation: string | null
}

/** Les six types de la mig 212 et leur geste. Le 7ᵉ devra passer par ici. */
// Le bouton décrit EXACTEMENT ce que l'humain va autoriser (quel objet naît) —
// jamais un « Ajouter » générique dont l'effet varie selon la carte.
const CAPABILITIES: Record<string, { label: string; requiredInputs: PromotionInputName[] }> = {
  action: { label: "Créer l'action", requiredInputs: [] },
  deadline: { label: "Ajouter l'échéance au planning", requiredInputs: [] },
  decision: { label: 'Acter la décision', requiredInputs: [] },
  // Le rôle ne se lit pas dans « Ginger » : la proposition est une chaîne nue.
  stakeholder: { label: "Créer l'intervenant", requiredInputs: ['role'] },
  vigilance: { label: 'Retenir le point de vigilance', requiredInputs: [] },
  // Périssable ou durable ? L'humain tranche, jamais le modèle.
  knowledge: { label: 'Confirmer cette information', requiredInputs: ['nature'] },
}

export function getPromotionCapability(kind: string): PromotionCapability {
  const c = CAPABILITIES[kind]
  if (!c) {
    return {
      available: false,
      label: null,
      requiredInputs: [],
      explanation: "MemorIA ne sait pas encore quoi faire de ce type d'élément.",
    }
  }
  return { available: true, label: c.label, requiredInputs: c.requiredInputs, explanation: null }
}

/** Les types promouvables — dérivés du contrat, jamais recopiés à côté. */
export const PROMOTABLE_KINDS = Object.keys(CAPABILITIES) as readonly string[]

export interface PromotionInput {
  /** Rôle sur le chantier (ETV / MOE / BET / …). REQUIS pour un intervenant. */
  role?: string
  /** L'entreprise, si l'humain corrige le nom lu (« Ginger SAS »). */
  companyName?: string
  /** La PERSONNE confirmée (« Vincent Milon »). Déclarée par l'humain, jamais
   *  devinée : c'est elle qui empêche le bug historique — sans distinction,
   *  confirmer une personne créait une ENTREPRISE à son nom. Exige companyName
   *  (mig 137 : tout contact vit sous une entreprise). */
  personName?: string
  /** Rattacher à un contact existant plutôt qu'au seul nom d'entreprise. */
  contactId?: string | null
  /** RATTACHER À UNE ENTREPRISE DÉJÀ CONNUE, par son id (2026-07-22).
   *
   *  Le nom ne suffit pas : la recherche affiche `short_name || name`, et
   *  `findOrCreateCompanyByName` compare sur `name`. Renvoyer le libellé affiché
   *  aurait donc CRÉÉ « Clim Expert » à côté de « Clim'Expert SARL » — le
   *  doublon même que le rattachement doit supprimer. L'humain désigne une
   *  identité ; on la prend telle quelle. */
  companyId?: string | null
  /** La NATURE d'une information. REQUIS pour 'knowledge' : « vraie maintenant »
   *  et « vraie durablement » ne se rangent pas au même endroit, et l'IA n'a pas
   *  à trancher. */
  knowledgeKind?: 'current_information' | 'durable_knowledge'
}

export async function promoteProposal(params: {
  id: string
  userId: string | null
  organizationId?: string | null
  input?: PromotionInput
}): Promise<PromotionOutcome> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('site_knowledge_proposals').select('*').eq('id', params.id).single()
  if (error || !data) return { status: 'not_found' }
  const p = data as DbKnowledgeProposal

  // Garde fail-closed (le service-role bypasse la RLS) : jamais promouvoir hors de son org.
  if (params.organizationId && p.organization_id && p.organization_id !== params.organizationId) {
    return { status: 'not_found' }
  }

  // Déjà promue : on renvoie l'objet existant (idempotent), on ne recrée rien.
  if (p.status !== 'proposed') {
    return p.promoted_object_type && p.promoted_object_id
      ? { status: 'promoted', objectType: p.promoted_object_type, objectId: p.promoted_object_id }
      : { status: 'not_found' }
  }

  // ── DÉJÀ AU JOURNAL ? ──────────────────────────────────────────────────────
  // La même chose a pu naître par l'autre porte — la concrétisation du
  // compte-rendu. On relit le journal AVANT de créer : confirmer une
  // proposition après avoir concrétisé la même ligne ne doit pas produire un
  // jumeau. La proposition est alors close sur l'objet existant.
  if (p.report_id) {
    const existing = await findInLedger(p.report_id, p.kind, p.title)
    if (existing) {
      const nowDup = new Date().toISOString()
      await supabase
        .from('site_knowledge_proposals')
        .update({
          status: 'confirmed',
          promoted_object_id: existing.entity_id,
          reviewed_at: nowDup,
          reviewed_by: params.userId,
          updated_at: nowDup,
        })
        .eq('id', params.id)
      return { status: 'promoted', objectType: existing.entity_type, objectId: existing.entity_id }
    }
  }

  // Ce qui manque se DEMANDE, avant tout travail : on ne crée pas une entreprise
  // pour découvrir ensuite qu'on n'a pas le rôle.
  const capability = getPromotionCapability(p.kind)
  if (!capability.available) return { status: 'unsupported', kind: p.kind }
  const missing = capability.requiredInputs.filter((i) =>
    i === 'role'
      ? !params.input?.role?.trim()
      : !params.input?.knowledgeKind || !isChoosableKnowledgeKind(params.input.knowledgeKind),
  )
  if (missing.length > 0) return { status: 'needs_input', missing }

  let result: PromotionResult
  if (p.kind === 'action') {
    const payload = (p.payload ?? {}) as { owner?: string | null }
    const id = await createSiteAction({
      site_id: p.site_id,
      report_id: p.report_id ?? null,
      title: p.title,
      body: p.body,
      assigned_to: payload.owner || null,
      created_by: params.userId,
      created_from: 'visit_debrief_ai',
    })
    result = { objectType: 'site_action', objectId: id }
  } else if (p.kind === 'deadline') {
    // On ne demande PAS la date pour confirmer. Le conducteur confirme qu'il s'agit
    // bien d'une échéance ; si le débrief n'a donné qu'une contrainte, elle naît
    // « à planifier » et attend sa date dans le Planning. Exiger une date ici
    // ferait renoncer — et l'échéance retournerait au néant dont on l'a tirée.
    const payload = (p.payload ?? {}) as { date?: string | null; constraint?: string | null }
    const due = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : null
    const id = await createSiteDeadline({
      site_id: p.site_id,
      report_id: p.report_id ?? null,
      organization_id: p.organization_id,
      title: p.title,
      // La contrainte survit à la confirmation : c'est elle qui dira plus tard
      // POURQUOI cette échéance attend, et avec les mots de celui qui l'a dite.
      constraint_text: payload.constraint ?? p.body,
      due_date: due,
      created_by: params.userId,
      created_from: 'visit_debrief_ai',
    })
    result = { objectType: 'site_deadline', objectId: id }
  } else if (p.kind === 'decision') {
    // Le conducteur confirme qu'une décision a bien été PRISE. `source: 'transcript'`
    // dit d'où elle vient : elle a été LUE dans un débrief, pas saisie à la main —
    // et `confiance: 'sûr'` parce qu'un humain vient de la valider. Sans quoi la
    // fiche chantier ne saurait plus distinguer ce qu'elle a entendu de ce qu'on
    // lui a affirmé.
    const id = await createSiteDecision({
      siteId: p.site_id,
      reportId: p.report_id ?? null,
      titre: p.title,
      description: p.body,
      source: 'transcript',
      confiance: 'sûr',
      createdBy: params.userId,
    })
    result = { objectType: 'site_decision', objectId: id }
  } else if (p.kind === 'stakeholder') {
    // Le RÔLE ne peut pas être deviné (cf. PromotionInput). Sans lui, on refuse —
    // on ne fabrique pas un casting que personne n'a dit.
    const role = params.input!.role!.trim()
    const orgId = params.organizationId ?? p.organization_id
    if (!orgId) return { status: 'not_found' }
    const personName = params.input?.personName?.trim() || null
    const companyName = params.input?.companyName?.trim() || null
    // Une PERSONNE exige son entreprise : le schéma (mig 137) rattache tout
    // contact à une entreprise, et créer une entreprise au nom d'une personne
    // est exactement le bug que cette branche corrige. Le manque est un état
    // métier — l'écran pose la question, il ne récolte pas une exception.
    if (personName && !companyName) return { status: 'needs_input', missing: ['company'] }
    // findOrCreateCompanyByName dédoublonne par nom normalisé : « Ginger » lu deux
    // fois sur deux visites ne crée pas deux entreprises.
    // L'identité désignée l'emporte sur tout nom lu : rattacher, ce n'est pas
    // renommer. La mention d'origine reste dans `title`, intacte.
    const companyId = params.input?.companyId
      ?? await findOrCreateCompanyByName(orgId, companyName ?? p.title)
    let contactId = params.input?.contactId ?? null
    if (!contactId && personName) contactId = await findOrCreateCompanyContact(orgId, companyId, personName)
    const intervenantId = await openSiteIntervenant({
      siteId: p.site_id,
      role,
      companyId,
      mainContactId: contactId,
      sourceReportId: p.report_id ?? null,
    })
    // promoted_object_id = le LIEN exact du casting (avant : l'entreprise — les
    // mentions d'une personne étaient introuvables depuis l'objet confirmé).
    result = { objectType: 'site_intervenant', objectId: intervenantId }
  } else if (p.kind === 'vigilance') {
    const orgId = params.organizationId ?? p.organization_id
    if (!orgId) return { status: 'not_found' }
    const payload = (p.payload ?? {}) as { impact?: string | null }
    const id = await createWatchpoint({
      organizationId: orgId,
      siteId: p.site_id,
      title: p.title,
      // L'impact dit POURQUOI ça mérite l'attention — il survit à la confirmation.
      body: payload.impact ?? p.body,
      reportId: p.report_id ?? null,
      sourceCaptureIds: p.source_capture_ids ?? [],
      confirmedBy: params.userId,
    })
    result = { objectType: 'site_watchpoint', objectId: id }
  } else if (p.kind === 'knowledge') {
    // La NATURE ne se devine pas : « l'avancement n'est pas encore défini » est
    // périssable, « Vincent Milon est l'interlocuteur PAVE » est durable. Demander
    // au modèle de trancher lui ferait porter un jugement qu'il raterait en
    // silence. L'humain choisit ; sans choix, on refuse.
    const kind = params.input!.knowledgeKind!
    const orgId = params.organizationId ?? p.organization_id
    if (!orgId) return { status: 'not_found' }
    const id = await createKnowledgeEntry({
      organizationId: orgId,
      siteId: p.site_id,
      kind,
      title: p.title,
      body: p.body,
      sourceReportId: p.report_id ?? null,
      sourceCaptureIds: p.source_capture_ids ?? [],
      confirmedBy: params.userId,
    })
    result = { objectType: 'site_knowledge_entry', objectId: id }
  } else {
    return { status: 'unsupported', kind: p.kind }
  }

  // ── LE JOURNAL UNIQUE (Vincent, 2026-07-21) ───────────────────────────────
  // La promotion inscrit ce qu'elle vient de créer là où la concrétisation du
  // compte-rendu inscrit déjà : un seul journal, une seule preuve. C'est ce qui
  // rend l'anti-doublon SYMÉTRIQUE — jusqu'ici la concrétisation voyait ce
  // qu'une promotion avait créé (via report_id), l'inverse était aveugle.
  //
  // Et c'est ce qui referme la provenance de l'intervenant : sa création par une
  // visite devient un ÉVÉNEMENT au journal, pas une propriété sur sa fiche.
  if (p.report_id) {
    await recordPromotionInLedger({
      reportId: p.report_id,
      kind: p.kind,
      label: p.title,
      entityId: result.objectId,
      proposalId: params.id,
    })
  }

  const now = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('site_knowledge_proposals')
    .update({
      status: 'confirmed',
      promoted_object_type: result.objectType,
      promoted_object_id: result.objectId,
      reviewed_at: now,
      reviewed_by: params.userId,
      updated_at: now,
    })
    .eq('id', params.id)
  if (updErr) throw updErr

  // ── L'INVALIDATION VIENT ICI, ET NULLE PART AILLEURS ────────────────────────
  // Les créateurs (`createSiteAction`, `createSiteDeadline`…) invalident déjà —
  // mais ils le font AVANT cette mise à jour. À ce moment-là la proposition est
  // encore 'proposed' : une recomposition déclenchée par eux recompterait le fait
  // comme « à confirmer » alors qu'il vient d'être confirmé.
  //
  // Deux d'entre eux n'invalidaient rien du tout (`createSiteDecision`,
  // `openSiteIntervenant`) : promouvoir une décision ou un intervenant ne
  // rafraîchissait aucun écran. C'est corrigé chez eux — mais s'appuyer sur le
  // créateur restait un pari. La promotion est UNE transaction : elle écrit le
  // fait ET retire la proposition. C'est elle qui doit invalider, une fois les
  // deux écritures réussies.
  //
  // Les retours anticipés au-dessus (not_found, needs_input, unsupported, déjà
  // promue) n'écrivent rien : ils n'ont rien à invalider.
  invalidateSiteProjection(p.site_id)
  return { status: 'promoted', objectType: result.objectType, objectId: result.objectId }
}

// ── L'AUTRE PORTE REFERME AUSSI LA PROPOSITION (Vincent, 2026-07-22) ─────────
//
// Le journal de concrétisation empêchait déjà le doublon d'OBJET : promouvoir
// une proposition déjà concrétisée rattache l'objet existant au lieu d'en créer
// un jumeau. Restait un mensonge d'ÉCRAN — créer quatre actions depuis le
// compte-rendu laissait leurs propositions en 'proposed', et le panneau
// continuait d'annoncer « 7 actions à décider » pour du travail déjà fait. Le
// conducteur avait l'impression que son clic n'avait servi à rien.
//
// LE RAPPROCHEMENT EST LEXICAL, ET C'EST SA LIMITE. On compare des signatures
// (famille canonique + libellé normalisé) : le compte-rendu ayant été CORRIGÉ,
// une action reformulée ne se reconnaîtra pas dans sa proposition d'origine et
// restera à arbitrer. C'est le sens prudent de l'erreur : laisser une ligne de
// trop dans le travail restant se répare d'un clic ; en retirer une à tort
// ferait disparaître un arbitrage que personne n'a rendu.
//
// Rien n'est supprimé : la ligne garde son texte, sa version d'analyse et sa
// provenance. Elle change d'état, et cesse simplement d'être du travail.

/**
 * Marque `fulfilled` les propositions de cette visite qu'une concrétisation
 * vient de satisfaire. Best-effort : jamais au prix des objets créés, qui eux
 * existent déjà quand on arrive ici.
 *
 * @returns le nombre de propositions refermées.
 */
export async function fulfillProposalsFromConcretisation(params: {
  reportId: string
  /** Ce qui vient d'être créé : famille d'origine et libellé, tels qu'écrits. */
  created: Array<{ kind: string; label: string; entityId: string | null }>
  userId: string | null
}): Promise<number> {
  if (params.created.length === 0) return 0
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, kind, title')
    .eq('report_id', params.reportId)
    .eq('status', 'proposed')
  if (error || !data) return 0

  // Une signature → l'objet né pour elle. La première création gagne : deux
  // lignes de même libellé sont le même fait, et le journal n'en a créé qu'un.
  const nesPourSignature = new Map<string, string | null>()
  for (const c of params.created) {
    const famille = canonicalFamily(c.kind)
    if (!famille) continue
    const sig = signatureOf({ kind: famille, label: c.label })
    if (!nesPourSignature.has(sig)) nesPourSignature.set(sig, c.entityId)
  }

  const aRefermer: Array<{ id: string; entityId: string | null }> = []
  for (const p of data as Array<{ id: string; kind: string; title: string }>) {
    const famille = canonicalFamily(p.kind)
    if (!famille) continue // une vigilance ne se concrétise pas : elle raconte.
    const sig = signatureOf({ kind: famille, label: p.title })
    if (!nesPourSignature.has(sig)) continue
    aRefermer.push({ id: p.id, entityId: nesPourSignature.get(sig) ?? null })
  }
  if (aRefermer.length === 0) return 0

  const now = new Date().toISOString()
  let refermees = 0
  for (const cible of aRefermer) {
    // `reviewed_by` reste NULL : personne n'a jugé CETTE proposition. Seul
    // `updated_at` bouge — l'état dit ce qui s'est passé, il ne s'invente pas
    // un auteur. La distinction 'confirmed' / 'fulfilled' n'aurait plus aucun
    // sens si on posait ici le même réviseur qu'une promotion.
    const { error: updErr } = await supabase
      .from('site_knowledge_proposals')
      .update({
        status: 'fulfilled',
        ...(cible.entityId ? { promoted_object_id: cible.entityId } : {}),
        updated_at: now,
      })
      .eq('id', cible.id)
      // Garde anti-concurrence : si un arbitrage a confirmé la proposition
      // entre la lecture et ici, on ne réécrit pas sa décision.
      .eq('status', 'proposed')
    if (!updErr) refermees += 1
  }
  return refermees
}
