// Phase 6E.3B.3C — contrat de recherche pour READY_NO_LOCAL_TARGET / targetingMode=SEARCH_REQUIRED
// (mandat Vincent, point 4). 114/155 pending traces evidence-ready (audit 6E.3B.3A) n'ont AUCUN
// candidat local — knownIdentityTargets=[] ET sameSubjectSuggestions=[] dans
// tracked-point-pending-resolution-queue.ts. Ce module prépare le contrat backend d'un futur
// écran de recherche humaine ; AUCUN écran n'est construit dans cette phase (Vincent : "pas
// besoin de construire l'écran").
//
// Portée non négociable : recherche STRICTEMENT au sein des Points actifs du MÊME site que la
// pending trace. Jamais tous les sites, jamais un site différent, même passé explicitement par
// erreur — siteId scope la lecture entière via loadTrackedPointReadModel(siteId), qui ne lit
// jamais au-delà d'un site (même garantie que le reste de la lecture Points).
//
// Aucun matching supplémentaire : ceci est un FILTRE (substring insensible à la casse sur le
// label), jamais un scoring, jamais un LLM, jamais un rail de tracked-point-membership-candidates.ts
// (moteur différent, pour une question différente : "quels threads appartiennent probablement à
// ce Point ?" — ici la question est "quel Point choisir parmi les Points actifs de ce site ?").
// Un résultat de recherche n'est jamais un identity_candidate : le rendre tel resterait un geste
// humain explicite passé à associatePendingResolutionToPoint en mode HUMAN_SELECTED_TARGET
// (candidateId=null), jamais une écriture de ce module.

import { loadTrackedPointReadModel, type PointReadModelEntry } from './tracked-point-read-model'
import { createAdminClient } from '@/lib/supabase/admin'

export type PointSearchResult = {
  pointId: string
  label: string
  subjectId: string | null
  subjectLabel: string | null
  derivedState: PointReadModelEntry['derivedState']
  identityStatus: PointReadModelEntry['identityStatus']
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

// searchActivePointsForSite : seuls les Points status='active' sont recherchables — un Point
// merged ou retired n'est jamais une cible d'association valide (guards 10/11 de la RPC 396 le
// refuseraient de toute façon ; ce module ne propose donc jamais une cible que la RPC rejetterait).
export async function searchActivePointsForSite(siteId: string, query?: string): Promise<PointSearchResult[]> {
  const { points } = await loadTrackedPointReadModel(siteId)
  const active = points.filter((p) => p.status === 'active')

  const subjectIds = [...new Set(active.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id))]
  const subjectLabelById = new Map<string, string>()
  if (subjectIds.length > 0) {
    const db = createAdminClient()
    const { data, error } = await db.from('canonical_subject').select('id, label').in('id', subjectIds)
    if (error) throw error
    for (const s of data ?? []) {
      if (s.label) subjectLabelById.set(s.id, s.label)
    }
  }

  const needle = query ? normalize(query) : null
  const results: PointSearchResult[] = []
  for (const p of active) {
    if (needle && !normalize(p.label).includes(needle)) continue
    results.push({
      pointId: p.id,
      label: p.label,
      subjectId: p.ownerCanonicalSubjectId,
      subjectLabel: p.ownerCanonicalSubjectId ? (subjectLabelById.get(p.ownerCanonicalSubjectId) ?? null) : null,
      derivedState: p.derivedState,
      identityStatus: p.identityStatus,
    })
  }
  return results
}
