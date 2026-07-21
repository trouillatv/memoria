'use server'

// CONCRÉTISER — créer le travail réel depuis le récit APPROUVÉ.
//
// Deux gestes serveur, et deux seulement :
//   · `prepareCrConcretisationAction` — relit le document CORRIGÉ et rend la
//     liste de ce qui peut être créé. Elle ne crée RIEN.
//   · `createFromCrAction` — crée les éléments que l'humain a cochés, et eux
//     seuls. Aucun objet n'apparaît dans le chantier sans ce clic.
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
}

export type PrepareResult =
  | { ok: true; items: ReviewItem[]; status: string; diff: OperationalDiff }
  | { ok: false; error: string }

async function open(reportId: string) {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false as const, error: 'Session expirée' }
  const visit = await getVisit(reportId)
  if (!visit?.site_id) return { ok: false as const, error: 'Visite introuvable' }
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
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
  const diff = diffOperationalItems(readOperationalItems(asProposedSections(ctx.doc.sections)), items)

  // Le REGISTRE de la section fait foi ; le libellé n'est plus qu'un second
  // garde-fou, pour les objets créés avant l'existence du registre.
  const bySection = new Map(ctx.doc.sections.map((s) => [s.key, s.concretisations]))

  return {
    ok: true,
    status: ctx.doc.status,
    diff,
    items: items.map((i) => {
      const match = matchConcretisation(i, bySection.get(i.sourceSection))
      return {
        ...i,
        creatable: i.kind !== 'intervenant',
        alreadyCreated: match !== null || dejaCrees.has(signatureOf(i)),
        entityId: match?.entry.entity_id,
        textChanged: match?.textChanged ?? false,
      }
    }),
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
    return { ok: false, error: 'Aucun élément n’a pu être créé' }
  }
  return { ok: true, summary: { byKind, total, skipped, failed, siteId } }
}
