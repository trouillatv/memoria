import 'server-only'

// P0-J.2 — Convergence déterministe du rattrapage corpus (GO Vincent 2026-08-24)
//
// Constat (rejeu manuel Guillaume, 4 passages externes) : reconcileHistoricalPvCanonicalSubjects()
// traite un run à la fois. Dans un passage séquentiel sur plusieurs runs, un thread du run N peut
// rester non résolu parce que le canonical_subject qu'il devrait rejoindre n'est créé que par un
// run M traité PLUS TARD dans ce même passage (ou lors d'un passage ultérieur). Ce n'est ni de la
// duplication ni du bruit LLM : c'est une propriété structurelle du traitement séquentiel par run.
// Rejouer l'ensemble des runs (sans changer leur ordre, sans changer les règles de matching) jusqu'à
// ce qu'un passage complet n'écrive plus rien élimine cet effet d'ordre en une seule invocation
// logique — exactement ce que les 4 invocations manuelles du script de rejeu ont prouvé empiriquement
// (9/57/64 → 2/5/6 → 0/1/0 → 0/0/0), désormais interne à une seule fonction.
//
// Doctrine stricte :
//   - ne modifie AUCUNE règle de matching/clustering (canonical-subject-source-reconcile.ts,
//     canonical-subject-resolve.ts restent intouchés) ; ce module ne fait qu'orchestrer des appels
//     répétés à reconcileHistoricalPvCanonicalSubjects(), déjà idempotent via
//     subject_thread_identity.subject_thread_id (ignoreDuplicates).
//   - un thread résolu (matched/created) ne repasse plus jamais par les phases de matching : le
//     nombre de threads encore non résolus est donc strictement décroissant ou stable d'un passage
//     à l'autre, jamais croissant — le point fixe est structurellement atteignable.
//   - borné (maxPasses) : un passage qui ne convergerait jamais (cas non observé en pratique) ne doit
//     jamais boucler indéfiniment.
//   - ne pose PAS les occurrences historiques (P0-B2) ni la projection FK (canonical-subject-project) :
//     celles-ci dépendent de l'identité STI finale et doivent être posées par l'appelant UNE FOIS la
//     convergence atteinte (elles sont déjà idempotentes/additives indépendamment de l'ordre des runs).

import {
  reconcileHistoricalPvCanonicalSubjects,
  type HistoricalReconcileFamilyStat,
} from '@/lib/db/canonical-subject-historical-reconcile'
import type { DocumentProposalFamily } from '@/types/db'

export interface HistoricalCorpusReconcileResult {
  siteId: string
  runIds: string[]
  /** Nombre de passages complets (sur l'ensemble des runIds) effectués. */
  passes: number
  /** true si un passage a produit 0 écriture (created + matchedExisting) avant maxPasses. */
  reachedFixedPoint: boolean
  /** Total des STI créés (nouveau canonical_subject), cumulé sur tous les passages. */
  totalCreated: number
  /** Total des STI rattachés à un canonical_subject existant, cumulé sur tous les passages. */
  totalMatched: number
  /** État par famille du DERNIER passage (ambiguous/unresolved = statut courant, pas cumulatif). */
  finalByFamily: HistoricalReconcileFamilyStat[]
  /** Union des canonical_subject touchés (rattachés ou créés) sur tous les passages. */
  touchedCanonicalSubjectIds: string[]
}

function emptyStat(family: DocumentProposalFamily): HistoricalReconcileFamilyStat {
  return { family, threads: 0, alreadyIdentified: 0, matchedExisting: 0, created: 0, ambiguous: 0, unresolved: 0 }
}

/**
 * P0-J.2 — Rejoue reconcileHistoricalPvCanonicalSubjects() sur l'ensemble des runIds fournis,
 * autant de passages complets que nécessaire jusqu'à ce qu'un passage n'écrive plus rien
 * (point fixe), borné par maxPasses. Même résultat final quel que soit l'ordre de runIds : les
 * écritures sont idempotentes et cumulatives, jamais annulées par un passage ultérieur.
 */
export async function reconcileHistoricalCorpusForSite(params: {
  siteId: string
  runIds: string[]
  maxPasses?: number
}): Promise<HistoricalCorpusReconcileResult> {
  const { siteId, runIds, maxPasses = 8 } = params

  const touchedCanonicalSubjectIds = new Set<string>()
  let totalCreated = 0
  let totalMatched = 0
  let pass = 0
  let reachedFixedPoint = false
  let finalByFamily: HistoricalReconcileFamilyStat[] = []

  while (pass < maxPasses) {
    pass++
    let passWrites = 0
    const passStats = new Map<DocumentProposalFamily, HistoricalReconcileFamilyStat>()
    const addStat = (s: HistoricalReconcileFamilyStat) => {
      const cur = passStats.get(s.family) ?? emptyStat(s.family)
      passStats.set(s.family, {
        family: s.family,
        threads: cur.threads + s.threads,
        alreadyIdentified: cur.alreadyIdentified + s.alreadyIdentified,
        matchedExisting: cur.matchedExisting + s.matchedExisting,
        created: cur.created + s.created,
        ambiguous: cur.ambiguous + s.ambiguous,
        unresolved: cur.unresolved + s.unresolved,
      })
    }

    for (const runId of runIds) {
      const result = await reconcileHistoricalPvCanonicalSubjects({ runId, siteId })
      for (const id of result.touchedCanonicalSubjectIds) touchedCanonicalSubjectIds.add(id)
      for (const s of result.byFamily) {
        addStat(s)
        passWrites += s.created + s.matchedExisting
      }
    }

    finalByFamily = [...passStats.values()]
    totalCreated += finalByFamily.reduce((acc, s) => acc + s.created, 0)
    totalMatched += finalByFamily.reduce((acc, s) => acc + s.matchedExisting, 0)

    if (passWrites === 0) {
      reachedFixedPoint = true
      break
    }
  }

  return {
    siteId,
    runIds,
    passes: pass,
    reachedFixedPoint,
    totalCreated,
    totalMatched,
    finalByFamily,
    touchedCanonicalSubjectIds: [...touchedCanonicalSubjectIds],
  }
}
