// LE JOURNAL UNIQUE DE CE QU'UNE VISITE A PRODUIT (Vincent, 2026-07-21).
//
// Deux portes mènent au chantier : la concrétisation du compte-rendu, et la
// promotion d'une proposition. Elles restent toutes deux ouvertes — l'intervenant
// n'a que la seconde — mais elles écrivent au MÊME endroit et se consultent
// AVANT d'écrire.
//
// Sans ce module, l'anti-doublon était asymétrique : la concrétisation relisait
// le chantier (elle voyait donc ce qu'une promotion avait créé), mais une
// promotion ne regardait rien. Confirmer une proposition après avoir concrétisé
// la même ligne créait un jumeau.
//
// Le journal est `report_documents.sections[].concretisations` — déjà là, aucune
// table nouvelle. La provenance de l'intervenant s'y range comme les autres :
// c'est un ÉVÉNEMENT de concrétisation, pas une propriété sur sa fiche.

import { createAdminClient } from '@/lib/supabase/admin'
import { getVisitCrDocument, writeConcretisationRegistry } from '@/lib/db/visit-cr-documents'
import { canonicalFamily, signatureOf, withConcretisation } from '@/lib/visits/cr-concretisation'
import type { SectionConcretisation } from '@/types/db'

/** La section où se rangent les objets nés d'une proposition. Ils ne viennent
 *  d'aucune ligne du compte-rendu : le dire plutôt que d'en inventer une. */
const PROPOSAL_SECTION = 'propositions'

/** Un objet déjà inscrit au journal porte-t-il cette identité ? */
export async function findInLedger(
  reportId: string,
  kind: string,
  label: string,
): Promise<SectionConcretisation | null> {
  const family = canonicalFamily(kind)
  if (!family) return null
  const doc = await getVisitCrDocument(reportId).catch(() => null)
  if (!doc) return null
  const wanted = signatureOf({ kind: family, label })
  for (const section of doc.sections) {
    for (const entry of section.concretisations ?? []) {
      const f = canonicalFamily(entry.entity_type)
      if (f && signatureOf({ kind: f, label: entry.source_text }) === wanted) return entry
    }
  }
  return null
}

/**
 * Inscrit au journal un objet né d'une PROPOSITION.
 *
 * Best-effort, comme pour la concrétisation : perdre une trace est ennuyeux,
 * perdre l'objet serait grave. Sans compte-rendu éditable, il n'y a pas encore
 * de journal — l'objet existe quand même, il sera simplement rattaché par
 * `report_id` jusqu'à ce qu'un document naisse.
 */
export async function recordPromotionInLedger(input: {
  reportId: string
  kind: string
  label: string
  entityId: string
  proposalId: string
}): Promise<void> {
  const family = canonicalFamily(input.kind)
  if (!family) return
  try {
    const doc = await getVisitCrDocument(input.reportId)
    if (!doc) return
    const sections = doc.sections.some((s) => s.key === PROPOSAL_SECTION)
      ? doc.sections
      : [
          ...doc.sections,
          // Une section TECHNIQUE, sans contenu : elle porte le journal, elle ne
          // s'imprime pas et ne se corrige pas. Le PDF ne rend que les sept
          // sections connues (DOC_ORDER) — celle-ci lui est invisible.
          { key: PROPOSAL_SECTION, title: 'Propositions confirmées', kind: 'fixed' as const, content: '' },
        ]
    const entry: SectionConcretisation = {
      item_key: `proposal:${input.proposalId}`,
      entity_type: family,
      entity_id: input.entityId,
      created_at: new Date().toISOString(),
      source_text: input.label,
    }
    await writeConcretisationRegistry(doc.id, withConcretisation(sections, PROPOSAL_SECTION, entry))
  } catch {
    // Jamais au prix de la promotion elle-même.
  }
}

/** Les objets du chantier nés de cette visite, toutes portes confondues —
 *  utile aux gardes anti-doublon qui ne lisent pas le journal. */
export async function reportLinkedIds(reportId: string): Promise<Set<string>> {
  const db = createAdminClient()
  const { data } = await db.from('site_actions').select('id').eq('report_id', reportId)
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}
