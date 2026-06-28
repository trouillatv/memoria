// lib/db/dossier-readings.ts
// READ-MODEL scopé DOSSIER + LENTILLES (Vincent 2026-06-29).
//
// Principe (CQRS read-model, cf. [[moteur-de-contexte-chantier]]) : UN SEUL endroit
// connaît le modèle et lit la base → getDossierReadModel(). Les LECTURES métier
// (reprise / AO / demain réunion / direction…) ne sont plus des agrégateurs qui
// relisent chacun la DB, mais des LENTILLES PURES au-dessus du read-model — zéro
// accès base, donc testables et sans duplication.
//
//   getDossierReadModel(scope)   ← lit la DB UNE fois, BORNÉ (1 site + 1 opération)
//        ↓
//   lensTakeover / lensTender    ← fonctions PURES, lisent seulement le read-model
//
// BORNES (anti god-object, cf. [[ai-cost-discipline]]) : le read-model est scopé à
// un dossier (+ son lieu), PAS « toute la mémoire ». On n'y met QUE ce que les
// lentilles consomment — il grandit par besoin de lentille, jamais spéculativement.
// DÉTERMINISTE : zéro IA. L'IA interprétera les lectures plus tard, gated.
// Cf. [[dossier-opportunite-colonne-vertebrale]], [[pv-reconstruction-manuelle]].

import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteSubjectsToWatch } from '@/lib/db/subjects'
import { listActiveCapturedKnowledgeBySite, listActiveCapturedKnowledgeByDossier } from '@/lib/db/captured-knowledge'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { listVisitCapturesByDossier } from '@/lib/db/visit-captures'
import { getDossier } from '@/lib/db/dossiers'

// ── LE READ-MODEL : substrat scopé Dossier (la seule chose qui lit la DB) ─────────

export interface DossierReadModel {
  identity: {
    dossier: Awaited<ReturnType<typeof getDossier>>
    site: Awaited<ReturnType<typeof getSiteIdentity>>
  }
  /** Mémoire de LIEU — permanente, partagée entre toutes les opérations du site. */
  siteMemory: {
    aSavoir: Awaited<ReturnType<typeof listSiteASavoirActive>>
    subjectsToWatch: Awaited<ReturnType<typeof listSiteSubjectsToWatch>>
    knowledge: Awaited<ReturnType<typeof listActiveCapturedKnowledgeBySite>>
  }
  /** Mémoire d'OPÉRATION — scopée au dossier (vide si lecture au scope lieu seul). */
  operationMemory: {
    captures: Awaited<ReturnType<typeof listVisitCapturesByDossier>>
    knowledge: Awaited<ReturnType<typeof listActiveCapturedKnowledgeByDossier>>
  }
}

/**
 * Assemble le read-model d'un dossier (ou d'un lieu seul, pour la reprise d'un
 * chantier legacy sans dossier). Lecture seule, déterministe, BORNÉE à un site +
 * une opération. C'est le SEUL point qui connaît les tables ; les lentilles ne
 * voient que l'objet retourné.
 */
export async function getDossierReadModel(input: { dossierId?: string; siteId?: string }): Promise<DossierReadModel> {
  const dossier = input.dossierId ? await getDossier(input.dossierId) : null
  const siteId = dossier?.site_id ?? input.siteId ?? null
  if (!siteId) {
    return {
      identity: { dossier, site: null },
      siteMemory: { aSavoir: [], subjectsToWatch: [], knowledge: [] },
      operationMemory: { captures: [], knowledge: [] },
    }
  }
  const dossierId = dossier?.id ?? null

  const [site, aSavoir, subjectsToWatch, siteKnowledge, opCaptures, opKnowledge] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    listSiteASavoirActive(siteId).catch(() => []),
    listSiteSubjectsToWatch(siteId, 12).catch(() => []),
    listActiveCapturedKnowledgeBySite(siteId, 200).catch(() => []),
    dossierId ? listVisitCapturesByDossier(dossierId).catch(() => []) : Promise.resolve([]),
    dossierId ? listActiveCapturedKnowledgeByDossier(dossierId).catch(() => []) : Promise.resolve([]),
  ])

  return {
    identity: { dossier, site },
    siteMemory: { aSavoir, subjectsToWatch, knowledge: siteKnowledge },
    operationMemory: { captures: opCaptures, knowledge: opKnowledge },
  }
}

// ── Types des lectures (sorties métier, inchangées) ──────────────────────────────

export interface TakeoverDossier {
  id: string
  name: string
  state: string
  cause: string | null
  openQuestion: string | null
}
export interface TakeoverItem { id: string; text: string; subjectId: string | null }

export interface TakeoverReading {
  siteName: string
  /** Ce qui appelle l'attention : les dossiers bloqués / en attente. */
  mustKnow: TakeoverDossier[]
  /** Promesses entendues (captured_knowledge kind=promise). */
  promises: TakeoverItem[]
  /** Risques (captured_knowledge kind=risk). */
  risks: TakeoverItem[]
  /** Pièges & habitudes : à-savoir du lieu + points d'attention / contexte / préférences. */
  pitfalls: TakeoverItem[]
  /** Documents manquants signalés. */
  missingDocuments: TakeoverItem[]
  isEmpty: boolean
}

export interface TenderObserved {
  photos: number
  verifications: number
  /** Vocaux transcrits — la parole du terrain, brute. */
  vocals: { id: string; text: string }[]
  /** Notes dictées/écrites sur site. */
  notes: { id: string; text: string }[]
  capturesTotal: number
}

export interface TenderReading {
  siteName: string
  clientName: string | null
  address: string | null
  /** Ce qu'on a observé sur site (matière brute à transformer en postes). */
  observed: TenderObserved
  /** Engagements entendus (client / BET) — kind=promise. */
  promises: TakeoverItem[]
  /** Risques de chiffrage identifiés — kind=risk. */
  risks: TakeoverItem[]
  /** Pièges & contraintes du lieu — à-savoir + attention/context/preference. */
  pitfalls: TakeoverItem[]
  /** Documents manquants / attendus — kind=missing_document. */
  missingDocuments: TakeoverItem[]
  /** Points déjà suivis qui appellent l'attention (rare sur une 1ʳᵉ prévisite). */
  toWatch: TakeoverDossier[]
  isEmpty: boolean
}

// ── LES LENTILLES : fonctions PURES sur le read-model (aucun accès DB) ────────────

/** Helper pur : projette les infos retenues d'un kind donné en items. */
function itemsByKind(knowledge: DossierReadModel['siteMemory']['knowledge'], kind: string): TakeoverItem[] {
  return knowledge.filter((k) => k.kind === kind).map((k) => ({ id: k.id, text: k.title, subjectId: k.subject_id }))
}

/**
 * « Si un nouveau chargé d'affaires reprend ce chantier demain, voilà ce qu'il
 * doit savoir. » Lit la mémoire de LIEU (chantier entier). Pure.
 */
export function lensTakeover(rm: DossierReadModel): TakeoverReading {
  const knowledge = rm.siteMemory.knowledge
  const mustKnow: TakeoverDossier[] = rm.siteMemory.subjectsToWatch.map((w) => ({
    id: w.id, name: w.name, state: w.state, cause: w.cause, openQuestion: w.openQuestion,
  }))
  const promises = itemsByKind(knowledge, 'promise')
  const risks = itemsByKind(knowledge, 'risk')
  const pitfalls: TakeoverItem[] = [
    ...rm.siteMemory.aSavoir.map((n) => ({ id: n.id, text: n.body, subjectId: null })),
    ...itemsByKind(knowledge, 'attention'),
    ...itemsByKind(knowledge, 'context'),
    ...itemsByKind(knowledge, 'preference'),
  ]
  const missingDocuments = itemsByKind(knowledge, 'missing_document')

  return {
    siteName: rm.identity.site?.name ?? 'Chantier',
    mustKnow,
    promises,
    risks,
    pitfalls,
    missingDocuments,
    isEmpty:
      mustKnow.length === 0 && promises.length === 0 && risks.length === 0 &&
      pitfalls.length === 0 && missingDocuments.length === 0,
  }
}

/**
 * « Aide-moi à répondre à cet appel d'offre. » Lit la mémoire d'OPÉRATION (captures
 * + infos retenues du dossier) + la mémoire de LIEU héritée (à-savoir). Pure.
 */
export function lensTender(rm: DossierReadModel): TenderReading {
  const captures = rm.operationMemory.captures
  const knowledge = rm.operationMemory.knowledge
  const hasText = (s: string | null): s is string => !!s && s.trim().length > 0

  const observed: TenderObserved = {
    photos: captures.filter((c) => c.kind === 'photo').length,
    verifications: captures.filter((c) => c.kind === 'verification').length,
    // Un vocal n'est exploitable que transcrit ; sinon il n'a pas de texte à lire.
    vocals: captures
      .filter((c) => c.kind === 'vocal' && hasText(c.body))
      .map((c) => ({ id: c.id, text: (c.body as string).trim() })),
    notes: captures
      .filter((c) => c.kind === 'note' && hasText(c.body))
      .map((c) => ({ id: c.id, text: (c.body as string).trim() })),
    capturesTotal: captures.length,
  }

  const promises = itemsByKind(knowledge, 'promise')
  const risks = itemsByKind(knowledge, 'risk')
  const pitfalls: TakeoverItem[] = [
    ...rm.siteMemory.aSavoir.map((n) => ({ id: n.id, text: n.body, subjectId: null })),
    ...itemsByKind(knowledge, 'attention'),
    ...itemsByKind(knowledge, 'context'),
    ...itemsByKind(knowledge, 'preference'),
  ]
  const missingDocuments = itemsByKind(knowledge, 'missing_document')
  const toWatch: TakeoverDossier[] = rm.siteMemory.subjectsToWatch.map((w) => ({
    id: w.id, name: w.name, state: w.state, cause: w.cause, openQuestion: w.openQuestion,
  }))

  return {
    siteName: rm.identity.dossier?.label ?? rm.identity.site?.name ?? 'Dossier',
    clientName: rm.identity.site?.clientName ?? null,
    address: rm.identity.site?.address ?? null,
    observed,
    promises,
    risks,
    pitfalls,
    missingDocuments,
    toWatch,
    isEmpty:
      observed.capturesTotal === 0 && promises.length === 0 && risks.length === 0 &&
      pitfalls.length === 0 && missingDocuments.length === 0 && toWatch.length === 0,
  }
}

// ── Fines enveloppes : gardent les appels de page inchangés (mêmes sorties) ───────

/** Reprise au scope LIEU (chantier) — résout le read-model puis applique la lentille. */
export async function readForTakeover(siteId: string): Promise<TakeoverReading> {
  return lensTakeover(await getDossierReadModel({ siteId }))
}

/** Lecture AO au scope OPÉRATION (dossier) — read-model puis lentille. */
export async function readForTender(dossierId: string): Promise<TenderReading> {
  return lensTender(await getDossierReadModel({ dossierId }))
}
