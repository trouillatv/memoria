'use server'

// CONCRÉTISER — créer le travail réel depuis le récit APPROUVÉ.
//
// Trois gestes serveur :
//   · `prepareCrConcretisationAction` — relit le document CORRIGÉ et rend la
//     liste de ce qui peut être créé. Elle ne crée RIEN.
//   · `createFromCrAction` — crée les éléments que l'humain a cochés, et eux
//     seuls. Aucun objet n'apparaît dans le chantier sans ce clic.
//   · `reintroduceRemovedItemAction` — crée l'objet correspondant à un élément
//     que Guillaume avait retiré du CR. L'ancienne proposition reste 'superseded'.
//
// La source est TOUJOURS `content` — le texte corrigé. Jamais `ai_content`,
// jamais l'ancien débrief : concrétiser depuis la proposition d'origine
// créerait dans le chantier ce que Guillaume vient de corriger.
//
// L'INTERVENANT N'EST PAS CRÉÉ ICI, et ce n'est pas un raccourci : un
// intervenant est une RELATION (rôle + entreprise + contact), pas un nom. Le
// texte du CR ne donne qu'un nom ; en fabriquer une ligne de casting
// inventerait le rôle. Il est donc listé, expliqué, et laissé au casting.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { getVisit } from '@/lib/db/visits'
import { getVisitCrDocument, writeConcretisationRegistry } from '@/lib/db/visit-cr-documents'
import type { SectionConcretisation } from '@/types/db'
import {
  readOperationalItems,
  diffOperationalItems,
  asProposedSections,
  signatureOf,
  toCreate,
  matchConcretisation,
  withConcretisation,
  type OperationalItem,
  type OperationalDiff,
} from '@/lib/visits/cr-concretisation'
import { createSiteAction, listSiteActionsByReport } from '@/lib/db/site-actions'
import { createSiteDeadline, listSiteDeadlines } from '@/lib/db/site-deadlines'
import { createSiteDecision, listDecisionsByReport } from '@/lib/db/site-decisions'
import { addCapturedKnowledge, listCapturedKnowledgeBySource } from '@/lib/db/captured-knowledge'
import { fulfillProposalsFromConcretisation } from '@/lib/db/knowledge-proposals'
import { loadOrRunVisitDebrief, type StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'

/** Provenance unique : tout ce qui naît d'un CR de visite le dit. */
const CREATED_FROM = 'cr_visite'

/**
 * CE QUI EXISTE DÉJÀ POUR CETTE VISITE, famille par famille.
 *
 * L'anti-doublon ne peut pas venir d'un drapeau posé sur le document : le
 * chantier est la seule vérité de ce qui a été créé. On regarde donc les objets
 * eux-mêmes, filtrés sur la visite d'origine.
 */
async function existingTitles(reportId: string, siteId: string): Promise<Set<string>> {
  const [actions, deadlines, decisions, knowledge] = await Promise.all([
    listSiteActionsByReport(reportId).catch(() => []),
    listSiteDeadlines(siteId).catch(() => []),
    listDecisionsByReport(reportId).catch(() => []),
    listCapturedKnowledgeBySource(reportId).catch(() => []),
  ])
  const set = new Set<string>()
  for (const a of actions) set.add(signatureOf({ kind: 'action', label: a.title }))
  for (const d of deadlines) {
    if (d.report_id === reportId) set.add(signatureOf({ kind: 'echeance', label: d.title }))
  }
  for (const d of decisions) set.add(signatureOf({ kind: 'decision', label: d.titre }))
  for (const k of knowledge) set.add(signatureOf({ kind: 'memoire', label: k.title }))
  return set
}

/** Un élément prêt à créer, tel que l'écran de revue le montre. */
export interface ReviewItem extends OperationalItem {
  /** L'objet créé depuis cet élément — la preuve, pas une supposition. */
  entityId?: string
  /** Déjà créé, mais le texte du CR a changé depuis. On le DIT, on ne
   *  réécrit rien : mettre à jour un objet du chantier parce qu'un mot a bougé
   *  serait une décision prise à la place de l'humain. */
  textChanged?: boolean
  /** Un objet portant déjà ce titre existe pour cette visite → on ne propose
   *  pas de le recréer. Revalider deux fois ne doit jamais doubler le chantier. */
  alreadyCreated: boolean
  /** `false` pour l'intervenant : listé, expliqué, mais pas créé ici. */
  creatable: boolean
  /** Cet élément était dans l'analyse initiale mais pas dans le CR corrigé ;
   *  l'humain a cliqué « Réintroduire » → l'objet existe dans le chantier
   *  mais la section du CR ne le mentionne plus. On l'affiche comme créé dans
   *  sa famille, avec cette origine explicitement signalée. */
  fromReintroduction?: boolean
}

export type PrepareResult =
  | { ok: true; items: ReviewItem[]; status: string; diff: OperationalDiff }
  | { ok: false; error: string }

async function open(reportId: string) {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false as const, error: 'Session expirée' }
  const visit = await getVisit(reportId)
  if (!visit?.site_id) return { ok: false as const, error: 'Visite introuvable' }
  // FRONTIÈRE ORG DEPUIS LA RESSOURCE (M2C). Avant : comparaison à
  // `user.organization_id` — l'org PAR DÉFAUT du profil, fausse dès qu'un compte
  // appartient à deux entreprises (elle refusait à tort une visite SERVINOR
  // pour un profil AGP). Désormais : membership actif à l'org de la visite,
  // sans exemption de rôle. Le service-role passe outre la RLS, le filtre est ICI.
  const access = await requireOrganizationMembership(visit.organization_id ?? '')
  if (!access.ok) {
    return { ok: false as const, error: 'Visite introuvable' }
  }
  const doc = await getVisitCrDocument(reportId)
  if (!doc) return { ok: false as const, error: 'Compte-rendu introuvable' }
  return { ok: true as const, user, visit, doc }
}

/**
 * « Reprendre la suite depuis mes corrections » — ce que le récit approuvé
 * produirait comme travail réel. Aucune écriture.
 */
export async function prepareCrConcretisationAction(reportId: string): Promise<PrepareResult> {
  const ctx = await open(reportId)
  if (!ctx.ok) return ctx

  const items = readOperationalItems(ctx.doc.sections)
  // Déjà créé ? On regarde le CHANTIER, pour les quatre familles. C'est le
  // garde-fou anti-doublon quand on revient sur un CR déjà concrétisé.
  const dejaCrees = await existingTitles(reportId, ctx.visit.site_id!)

  // CE QUE MES CORRECTIONS ONT CHANGÉ. On compare ce que produit le texte
  // corrigé à ce que produisait la proposition d'origine : le conducteur voit
  // l'effet de son travail, il ne relit pas une liste sans repère.
  const rawDiff = diffOperationalItems(readOperationalItems(asProposedSections(ctx.doc.sections)), items)

  // Les éléments "retirés" que l'humain a réintroduits via le bouton dédié :
  // ils existent déjà dans le chantier → sortent de la liste "retirés"
  // et rejoignent leur famille dans la liste active, marqués clairement.
  const reintroducedFromRemoved = rawDiff.removed.filter(
    (r) => r.kind !== 'intervenant' && dejaCrees.has(signatureOf(r)),
  )
  const stillRemoved = rawDiff.removed.filter(
    (r) => r.kind === 'intervenant' || !dejaCrees.has(signatureOf(r)),
  )
  const diff = { ...rawDiff, removed: stillRemoved }

  // Le REGISTRE de la section fait foi ; le libellé n'est plus qu'un second
  // garde-fou, pour les objets créés avant l'existence du registre.
  const bySection = new Map(ctx.doc.sections.map((s) => [s.key, s.concretisations]))

  const mainItems: ReviewItem[] = items.map((i) => {
    const match = matchConcretisation(i, bySection.get(i.sourceSection))
    return {
      ...i,
      creatable: i.kind !== 'intervenant',
      alreadyCreated: match !== null || dejaCrees.has(signatureOf(i)),
      entityId: match?.entry.entity_id,
      textChanged: match?.textChanged ?? false,
    }
  })

  // Items synthétiques pour les éléments réintroduits — ils n'apparaissent
  // pas dans content mais existent dans le chantier. Clé préfixée pour éviter
  // toute collision avec les items positionnels du texte corrigé.
  const reintroducedItems: ReviewItem[] = reintroducedFromRemoved.map((r) => ({
    ...r,
    key: `reintr:${r.key}`,
    creatable: true,
    alreadyCreated: true,
    textChanged: false,
    fromReintroduction: true,
  }))

  return {
    ok: true,
    status: ctx.doc.status,
    diff,
    items: [...mainItems, ...reintroducedItems],
  }
}

/** Le compte-rendu de la transaction : ce qui est né, et ce qui a résisté. */
export interface CreationSummary {
  /** Nombre créé par famille — ce que l'écran annonce, ligne par ligne. */
  byKind: Record<string, number>
  total: number
  /** Déjà présents : ignorés en silence, jamais recréés. */
  skipped: number
  /** Ce qui a échoué, nommé. On ne masque pas un échec. */
  failed: string[]
  /** Où aller ensuite. */
  siteId: string
}

export type CreateResult = { ok: true; summary: CreationSummary } | { ok: false; error: string }

/**
 * Crée dans le chantier les éléments COCHÉS, et eux seuls. Chaque objet garde
 * sa provenance : la visite d'origine (`report_id`) et `created_from`.
 */
export async function createFromCrAction(reportId: string, keys: string[]): Promise<CreateResult> {
  const ctx = await open(reportId)
  if (!ctx.ok) return ctx
  const chosen = new Set(keys)
  if (chosen.size === 0) return { ok: false, error: 'Rien de sélectionné' }

  const siteId = ctx.visit.site_id!
  const userId = ctx.user.id
  const items = readOperationalItems(ctx.doc.sections).filter(
    (i) => chosen.has(i.key) && i.kind !== 'intervenant',
  )

  // L'IDEMPOTENCE SE VÉRIFIE ICI, PAS SEULEMENT À L'AFFICHAGE. Entre la
  // préparation et le clic, un autre onglet a pu créer. On relit donc le
  // chantier juste avant d'écrire : relancer la création est toujours sans
  // danger — c'est ce qui remplace un rollback, et c'est mieux qu'un rollback,
  // car un échec partiel ne détruit pas ce qui a réussi.
  const deja = await existingTitles(reportId, siteId)
  // La règle vit dans le module pur, sous test : elle écarte ce qui existe déjà
  // ET les doublons internes à la sélection.
  const { create, skipped: ignores } = toCreate(items, deja)

  const byKind: Record<string, number> = {}
  const failed: string[] = []
  const skipped = ignores.length
  // Ce qui est né, à inscrire au registre du document une fois la boucle finie.
  const registre: Array<{ section: string; entry: SectionConcretisation }> = []
  // Ce qui est né, pour refermer les propositions que ça satisfait.
  const nes: Array<{ kind: string; label: string; entityId: string | null }> = []
  const stamp = new Date().toISOString()

  for (const item of create) {
    try {
      let entityId: string | null = null
      if (item.kind === 'action') {
        entityId = await createSiteAction({
          site_id: siteId,
          report_id: reportId,
          title: item.label,
          due_date: item.due,
          // Une date DITE est explicite ; jamais estimée à notre initiative.
          due_date_status: item.due ? 'explicit' : null,
          created_by: userId,
          created_from: CREATED_FROM,
        })
      } else if (item.kind === 'echeance') {
        entityId = await createSiteDeadline({
          site_id: siteId,
          report_id: reportId,
          organization_id: ctx.visit.organization_id ?? null,
          title: item.label,
          constraint_text: item.constraint,
          due_date: item.due,
          created_by: userId,
          created_from: CREATED_FROM,
        })
      } else if (item.kind === 'decision') {
        entityId = await createSiteDecision({
          siteId,
          reportId,
          titre: item.label,
          echeance: item.due,
          // « à confirmer » : un humain l'a écrite, mais elle n'a pas été actée
          // en réunion. On ne surclasse jamais une source.
          confiance: 'à confirmer',
        })
      } else {
        entityId = await addCapturedKnowledge({
          siteId,
          sourceType: 'visit',
          sourceId: reportId,
          kind: 'a_savoir',
          title: item.label,
          createdBy: userId,
        })
      }
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
      nes.push({ kind: item.kind, label: item.label, entityId })
      if (entityId) {
        registre.push({
          section: item.sourceSection,
          entry: {
            item_key: item.key,
            entity_type: item.kind as SectionConcretisation['entity_type'],
            entity_id: entityId,
            created_at: stamp,
            source_text: item.label,
          },
        })
      }
    } catch {
      // Un échec n'annule pas les autres : perdre douze créations réussies
      // pour une qui a raté serait pire que le problème. On le NOMME, et
      // relancer est sans risque puisque l'anti-doublon protège.
      failed.push(item.label)
    }
  }

  // LE REGISTRE S'ÉCRIT APRÈS LES CRÉATIONS, jamais avant : on n'inscrit que
  // ce qui existe vraiment. Une écriture ratée ici ne perd rien — le garde-fou
  // par libellé prend le relais jusqu'à la prochaine concrétisation.
  //
  // Il passe par `writeConcretisationRegistry`, qui ignore le statut : un CR
  // FINALISÉ ne se réécrit pas dans son contenu, mais il peut encore faire
  // naître des objets, et cette trace-là doit s'inscrire.
  if (registre.length > 0) {
    try {
      let sections = ctx.doc.sections
      for (const r of registre) sections = withConcretisation(sections, r.section, r.entry)
      await writeConcretisationRegistry(ctx.doc.id, sections)
    } catch {
      // silencieux : ne jamais faire échouer une création réussie sur sa trace
    }
  }

  // ── LA PROPOSITION SATISFAITE CESSE D'ÊTRE DU TRAVAIL (mig 231) ───────────
  //
  // Le journal empêchait déjà le doublon d'OBJET. Restait un mensonge d'ÉCRAN :
  // les propositions correspondantes restaient 'proposed', et le panneau
  // annonçait « 7 actions à décider » juste après qu'on en ait créé quatre. Le
  // clic semblait n'avoir servi à rien.
  //
  // Après l'écriture, jamais avant : on ne referme que ce qui existe vraiment.
  // Best-effort — les objets, eux, sont déjà nés ; perdre ce rapprochement se
  // rattrape d'un arbitrage, perdre une création serait grave.
  try {
    await fulfillProposalsFromConcretisation({ reportId, created: nes, userId })
  } catch {
    // silencieux : ne jamais faire échouer une création réussie sur son écho
  }

  const total = Object.values(byKind).reduce((n, v) => n + v, 0)
  if (total === 0 && skipped === 0) {
    return { ok: false, error: "Aucun élément n’a pu être créé" }
  }
  return { ok: true, summary: { byKind, total, skipped, failed, siteId } }
}

export type ReintroduceResult =
  | { ok: true; alreadyExisted: boolean }
  | { ok: false; error: string }

export async function reintroduceRemovedItemAction(
  reportId: string,
  item: Pick<OperationalItem, "kind" | "label" | "owner" | "due" | "constraint" | "sourceSection">,
): Promise<ReintroduceResult> {
  const ctx = await open(reportId)
  if (!ctx.ok) return ctx

  if (item.kind === "intervenant") {
    return { ok: false, error: "Les intervenants ne peuvent pas être réintroduits ici" }
  }

  const siteId = ctx.visit.site_id!
  const userId = ctx.user.id

  const deja = await existingTitles(reportId, siteId)
  if (deja.has(signatureOf(item))) {
    return { ok: true, alreadyExisted: true }
  }

  const stamp = new Date().toISOString()
  let entityId: string | null = null

  try {
    if (item.kind === "action") {
      entityId = await createSiteAction({
        site_id: siteId,
        report_id: reportId,
        title: item.label,
        due_date: item.due,
        due_date_status: item.due ? "explicit" : null,
        created_by: userId,
        created_from: CREATED_FROM,
      })
    } else if (item.kind === "echeance") {
      entityId = await createSiteDeadline({
        site_id: siteId,
        report_id: reportId,
        organization_id: ctx.visit.organization_id ?? null,
        title: item.label,
        constraint_text: item.constraint,
        due_date: item.due,
        created_by: userId,
        created_from: CREATED_FROM,
      })
    } else if (item.kind === "decision") {
      entityId = await createSiteDecision({
        siteId,
        reportId,
        titre: item.label,
        echeance: item.due,
        confiance: "à confirmer",
      })
    } else {
      entityId = await addCapturedKnowledge({
        siteId,
        sourceType: "visit",
        sourceId: reportId,
        kind: "a_savoir",
        title: item.label,
        createdBy: userId,
      })
    }
  } catch {
    return { ok: false, error: "La création a échoué" }
  }

  if (entityId) {
    try {
      const entry: SectionConcretisation = {
        item_key: `reintr:${item.kind}:${item.label}`,
        entity_type: item.kind as SectionConcretisation["entity_type"],
        entity_id: entityId,
        created_at: stamp,
        source_text: item.label,
      }
      const sections = withConcretisation(ctx.doc.sections, item.sourceSection, entry)
      await writeConcretisationRegistry(ctx.doc.id, sections)
    } catch {
      // silencieux
    }

    try {
      await fulfillProposalsFromConcretisation({
        reportId,
        created: [{ kind: item.kind, label: item.label, entityId }],
        userId,
      })
    } catch {
      // silencieux
    }
  }

  return { ok: true, alreadyExisted: false }
}

// ── RÉANALYSER LA VISITE ─────────────────────────────────────────────────────
//
// Lance un passage LLM frais sur les sources de la visite (vocaux, notes,
// captures) SANS écrire le résultat ni projeter les propositions. Renvoie
// la liste d'éléments candidats : l'humain voit la diff et décide.

export type CandidateAnalysisResult =
  | { ok: true; candidateItems: OperationalItem[]; crItems: OperationalItem[] }
  | { ok: false; error: string }

function analysisToOperationalItems(analysis: StoredDebriefAnalysis): OperationalItem[] {
  const items: OperationalItem[] = []
  analysis.actions.forEach((a, i) => {
    const label = a.title?.trim()
    if (!label) return
    items.push({
      key: `cand:action:${i}`,
      kind: "action",
      label,
      owner: a.owner?.trim() || null,
      due: a.due?.trim() || null,
      constraint: null,
      sourceSection: "actions",
    })
  })
  analysis.echeances.forEach((e, i) => {
    const label = e.label?.trim()
    if (!label) return
    items.push({
      key: `cand:echeance:${i}`,
      kind: "echeance",
      label,
      owner: null,
      due: e.date?.trim() || null,
      constraint: e.constraint?.trim() || null,
      sourceSection: "echeances",
    })
  })
  analysis.decisions.forEach((d, i) => {
    const label = d?.trim()
    if (!label) return
    items.push({
      key: `cand:decision:${i}`,
      kind: "decision",
      label,
      owner: null,
      due: null,
      constraint: null,
      sourceSection: "decisions",
    })
  })
  analysis.a_savoir.forEach((s, i) => {
    const label = s?.trim()
    if (!label) return
    items.push({
      key: `cand:memoire:${i}`,
      kind: "memoire",
      label,
      owner: null,
      due: null,
      constraint: null,
      sourceSection: "a_savoir",
    })
  })
  analysis.intervenants.forEach((p, i) => {
    const label = p?.trim()
    if (!label) return
    items.push({
      key: `cand:intervenant:${i}`,
      kind: "intervenant",
      label,
      owner: null,
      due: null,
      constraint: null,
      sourceSection: "intervenants",
    })
  })
  return items
}

export async function runCandidateAnalysisAction(reportId: string): Promise<CandidateAnalysisResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: "Non autorisé" }
  const visit = await getVisit(reportId)
  if (!visit) return { ok: false, error: "Visite introuvable" }
  if (visit.organization_id) {
    const access = await requireOrganizationMembership(visit.organization_id)
    if (!access.ok) return { ok: false, error: "Accès refusé" }
  }

  const result = await loadOrRunVisitDebrief(reportId, user.id, { force: true, dryRun: true })
  if (!result.ok) return { ok: false, error: result.error }
  if (result.status === "generating") return { ok: false, error: "Une analyse est déjà en cours. Réessayez dans quelques secondes." }
  if (!result.loaded) return { ok: false, error: "Aucune analyse disponible" }

  const candidateItems = analysisToOperationalItems(result.loaded.analysis)

  // Lire le CR actuel pour permettre la comparaison côté serveur.
  const doc = await getVisitCrDocument(reportId)
  const crItems = doc ? readOperationalItems(doc.sections) : []

  return { ok: true, candidateItems, crItems }
}
