// lib/db/dossier-readings.ts
// LECTURES MÉTIER du dossier vivant (Vincent 2026-06-28). On ne change jamais les
// données — on change la FAÇON de raconter l'histoire selon le contexte.
//
// `readForTakeover` = « si un nouveau chargé d'affaires reprend ce chantier demain,
// voilà ce qu'il doit savoir ». DÉTERMINISTE (zéro IA) : agrège ce qui appelle
// l'attention (dossiers bloqués/en attente) + les infos retenues (promesses /
// risques / pièges) + les à-savoir du lieu. L'IA, plus tard, INTERPRÉTERA ces
// lectures — elle ne les produit pas. Cf. [[continuite-operationnelle-2026-05-22]].

import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteSubjectsToWatch } from '@/lib/db/subjects'
import { listActiveCapturedKnowledgeBySite, listActiveCapturedKnowledgeByDossier } from '@/lib/db/captured-knowledge'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { listVisitCapturesByDossier } from '@/lib/db/visit-captures'
import { getDossier } from '@/lib/db/dossiers'

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

export async function readForTakeover(siteId: string): Promise<TakeoverReading> {
  const [identity, watched, knowledge, aSavoir] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    listSiteSubjectsToWatch(siteId, 12).catch(() => []),
    listActiveCapturedKnowledgeBySite(siteId, 200).catch(() => []),
    listSiteASavoirActive(siteId).catch(() => []),
  ])

  const byKind = (kind: string): TakeoverItem[] =>
    knowledge.filter((k) => k.kind === kind).map((k) => ({ id: k.id, text: k.title, subjectId: k.subject_id }))

  const mustKnow: TakeoverDossier[] = watched.map((w) => ({
    id: w.id, name: w.name, state: w.state, cause: w.cause, openQuestion: w.openQuestion,
  }))
  const promises = byKind('promise')
  const risks = byKind('risk')
  const pitfalls: TakeoverItem[] = [
    ...((aSavoir ?? []) as Array<{ id: string; body: string }>).map((n) => ({ id: n.id, text: n.body, subjectId: null })),
    ...byKind('attention'),
    ...byKind('context'),
    ...byKind('preference'),
  ]
  const missingDocuments = byKind('missing_document')

  return {
    siteName: identity?.name ?? 'Chantier',
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

// ── readForTender ────────────────────────────────────────────────────────────
// « Aide-moi à répondre à cet appel d'offre. » LECTURE métier d'une PRÉVISITE,
// orientée réponse AO (Vincent 2026-06-29). DÉTERMINISTE — même invariant que le
// PV (cf. [[pv-reconstruction-manuelle]]) : Guillaume obtient son dossier AO
// MÊME si l'IA n'a rien compris. La couche « voilà ce que j'ai compris » (IA)
// viendra PAR-DESSUS, gated. Ici : on restitue la matière captée, organisée pour
// chiffrer — observé sur site / engagements entendus / risques / pièges & contraintes
// / documents attendus. Frère de readForTakeover : même moteur, autre angle.

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

export async function readForTender(dossierId: string): Promise<TenderReading> {
  const dossier = await getDossier(dossierId)
  if (!dossier) {
    return {
      siteName: 'Dossier', clientName: null, address: null,
      observed: { photos: 0, verifications: 0, vocals: [], notes: [], capturesTotal: 0 },
      promises: [], risks: [], pitfalls: [], missingDocuments: [], toWatch: [], isEmpty: true,
    }
  }
  const siteId = dossier.site_id
  const [identity, captures, knowledge, aSavoir, watched] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    // Matière d'OPÉRATION : scopée au dossier (un lieu peut en porter plusieurs).
    listVisitCapturesByDossier(dossierId).catch(() => []),
    listActiveCapturedKnowledgeByDossier(dossierId).catch(() => []),
    // Mémoire de LIEU : héritée du site, partagée entre tous ses dossiers (le moat).
    listSiteASavoirActive(siteId).catch(() => []),
    listSiteSubjectsToWatch(siteId, 12).catch(() => []),
  ])

  const byKind = (kind: string): TakeoverItem[] =>
    knowledge.filter((k) => k.kind === kind).map((k) => ({ id: k.id, text: k.title, subjectId: k.subject_id }))

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

  const promises = byKind('promise')
  const risks = byKind('risk')
  const pitfalls: TakeoverItem[] = [
    ...((aSavoir ?? []) as Array<{ id: string; body: string }>).map((n) => ({ id: n.id, text: n.body, subjectId: null })),
    ...byKind('attention'),
    ...byKind('context'),
    ...byKind('preference'),
  ]
  const missingDocuments = byKind('missing_document')
  const toWatch: TakeoverDossier[] = watched.map((w) => ({
    id: w.id, name: w.name, state: w.state, cause: w.cause, openQuestion: w.openQuestion,
  }))

  return {
    siteName: dossier.label ?? identity?.name ?? 'Dossier',
    clientName: identity?.clientName ?? null,
    address: identity?.address ?? null,
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
