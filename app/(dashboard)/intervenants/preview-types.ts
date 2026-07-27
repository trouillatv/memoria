// Type partagé de l'aperçu maître-détail. Isolé du fichier « use server »
// (preview-actions.ts) qui, lui, ne peut exporter QUE des fonctions async.

import type { PersonFiche } from '@/lib/db/person-fiche'
import type { CompanyFiche } from '@/lib/db/company-fiche'
import type { TeamActorInsight } from '@/lib/db/team-actor-insight'

export type ActorPreview =
  | { kind: 'person'; fiche: PersonFiche }
  | { kind: 'company'; fiche: CompanyFiche }
  | { kind: 'team'; insight: TeamActorInsight }
  | null
