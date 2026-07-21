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
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { readOperationalItems, type OperationalItem } from '@/lib/visits/cr-concretisation'
import { createSiteAction, listSiteActionsByReport } from '@/lib/db/site-actions'
import { createSiteDeadline } from '@/lib/db/site-deadlines'
import { createSiteDecision } from '@/lib/db/site-decisions'
import { addCapturedKnowledge } from '@/lib/db/captured-knowledge'

/** Un élément prêt à créer, tel que l'écran de revue le montre. */
export interface ReviewItem extends OperationalItem {
  /** Un objet portant déjà ce titre existe pour cette visite → on ne propose
   *  pas de le recréer. Revalider deux fois ne doit jamais doubler le chantier. */
  alreadyCreated: boolean
  /** `false` pour l'intervenant : listé, expliqué, mais pas créé ici. */
  creatable: boolean
}

export type PrepareResult =
  | { ok: true; items: ReviewItem[]; status: string }
  | { ok: false; error: string }

const norm = (s: string) => s.trim().toLowerCase()

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
  // Déjà créé ? On regarde les ACTIONS du chantier nées de cette visite. C'est
  // le garde-fou anti-doublon quand on revient sur un CR déjà concrétisé.
  const existing = await listSiteActionsByReport(reportId).catch(() => [])
  const dejaCrees = new Set(existing.map((a) => norm(a.title)))

  return {
    ok: true,
    status: ctx.doc.status,
    items: items.map((i) => ({
      ...i,
      creatable: i.kind !== 'intervenant',
      alreadyCreated: i.kind === 'action' && dejaCrees.has(norm(i.label)),
    })),
  }
}

export type CreateResult = { ok: true; created: number } | { ok: false; error: string }

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
  const items = readOperationalItems(ctx.doc.sections).filter((i) => chosen.has(i.key))

  let created = 0
  for (const item of items) {
    try {
      if (item.kind === 'action') {
        await createSiteAction({
          site_id: siteId,
          report_id: reportId,
          title: item.label,
          due_date: item.due,
          // Une date DITE est explicite ; jamais estimée à notre initiative.
          due_date_status: item.due ? 'explicit' : null,
          created_by: userId,
          created_from: 'report',
        })
      } else if (item.kind === 'echeance') {
        await createSiteDeadline({
          site_id: siteId,
          report_id: reportId,
          organization_id: ctx.visit.organization_id ?? null,
          title: item.label,
          constraint_text: item.constraint,
          due_date: item.due,
          created_by: userId,
          created_from: 'cr_visite',
        })
      } else if (item.kind === 'decision') {
        await createSiteDecision({
          siteId,
          reportId,
          titre: item.label,
          echeance: item.due,
          // « à confirmer » : c'est un humain qui l'a écrite, mais elle n'a pas
          // été actée en réunion. On ne surclasse jamais une source.
          confiance: 'à confirmer',
        })
      } else if (item.kind === 'memoire') {
        await addCapturedKnowledge({
          siteId,
          sourceType: 'visit',
          sourceId: reportId,
          kind: 'a_savoir',
          title: item.label,
          createdBy: userId,
        })
      } else {
        continue // intervenant : jamais créé ici (cf. en-tête)
      }
      created++
    } catch {
      // Un échec sur un élément n'annule pas les autres : le conducteur voit
      // ce qui est passé, et peut relancer le reste sans tout refaire.
    }
  }

  if (created === 0) return { ok: false, error: 'Aucun élément n’a pu être créé' }
  return { ok: true, created }
}
