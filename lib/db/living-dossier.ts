// lib/db/living-dossier.ts
// LE DOSSIER VIVANT — source CANONIQUE d'un point suivi (Vincent 2026-06-28).
//
// « Porte RF30 » n'est pas une fiche, c'est une histoire : décisions + actions +
// réserves + obligations + infos retenues + captures de visite, assemblées au même
// endroit. Une seule fonction pour TOUTES les surfaces (page point suivi, briefing,
// visite, atelier IA, dossier de reprise) → une seule version de la vérité, jamais
// cinq reconstructions divergentes. Refactor (pas une nouvelle couche) : centralise
// ce que la page point suivi assemblait déjà. Cf. [[vue-sujet-unite-memoire]],
// [[continuite-operationnelle-2026-05-22]].

import { getSiteIdentity } from '@/lib/db/site-cockpit'
import {
  getSubjectThread,
  getSubjectTimeline,
  getSubjectInsights,
  type SubjectThread,
  type SubjectEvent,
  type SubjectInsights,
} from '@/lib/db/subjects'
import { getSubjectRelations } from '@/lib/db/subject-relations'
import { listCapturedKnowledgeBySubject, type CapturedKnowledgeRow } from '@/lib/db/captured-knowledge'
import { listVisitCapturesBySubject, type VisitCaptureRow } from '@/lib/db/visit-captures'

export interface LivingDossier {
  identity: NonNullable<Awaited<ReturnType<typeof getSiteIdentity>>>
  thread: SubjectThread
  timeline: SubjectEvent[]
  insights: SubjectInsights | null
  relations: Awaited<ReturnType<typeof getSubjectRelations>>
  /** Infos retenues (captured_knowledge) rattachées à ce point. */
  capturedKnowledge: CapturedKnowledgeRow[]
  /** Captures de visite rattachées (vérifications/photos/vocaux/notes). */
  visitCaptures: VisitCaptureRow[]
  /** Dernière trace de l'histoire (date du dernier événement). */
  lastActivity: string | null
}

/**
 * Assemble le dossier vivant d'un point suivi. Renvoie null si le point n'existe
 * pas ou n'appartient pas au site. Lecture seule, zéro écriture.
 */
export async function getLivingDossier(siteId: string, subjectId: string): Promise<LivingDossier | null> {
  const [identity, thread, timeline, insights, relations, capturedKnowledge, visitCaptures] = await Promise.all([
    getSiteIdentity(siteId),
    getSubjectThread(subjectId),
    getSubjectTimeline(subjectId),
    getSubjectInsights(subjectId),
    getSubjectRelations(subjectId),
    listCapturedKnowledgeBySubject(subjectId).catch(() => []),
    listVisitCapturesBySubject(subjectId).catch(() => []),
  ])

  if (!identity || !thread || thread.subject.site_id !== siteId) return null

  // timeline est en ordre chronologique croissant → le dernier = la dernière trace.
  const lastActivity = timeline.length > 0 ? timeline[timeline.length - 1].date : null

  return { identity, thread, timeline, insights, relations, capturedKnowledge, visitCaptures, lastActivity }
}
