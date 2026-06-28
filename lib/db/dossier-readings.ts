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
import { listActiveCapturedKnowledgeBySite } from '@/lib/db/captured-knowledge'
import { listSiteASavoirActive } from '@/lib/db/sites'

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
