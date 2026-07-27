// Type partagé de l'aperçu maître-détail. Isolé du fichier « use server »
// (preview-actions.ts) qui, lui, ne peut exporter QUE des fonctions async.

import type { PersonFiche } from '@/lib/db/person-fiche'
import type { CompanyFiche } from '@/lib/db/company-fiche'
import type { TeamActorInsight } from '@/lib/db/team-actor-insight'
import type { ActorsGraph } from '@/lib/knowledge/actors-graph'

export type ActorPreview =
  | { kind: 'person'; fiche: PersonFiche; network: ActorsGraph }
  | { kind: 'company'; fiche: CompanyFiche; network: ActorsGraph }
  | { kind: 'team'; insight: TeamActorInsight; network: ActorsGraph }
  | null
