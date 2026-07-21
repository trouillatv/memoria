// N1 — LE RÉCIT DE VISITE (Vincent, 2026-07-21).
//
// « Le problème n'est pas l'absence de provenance. Le problème est l'absence
//   d'un récit qui exploite cette provenance. »
//
// Ce module définit le contrat du récit et sa seule règle non triviale : ce
// qu'on a le DROIT d'appeler « produit par cette visite ». Il est PUR — aucune
// base, aucun réseau — pour que cette règle soit prouvable.
//
// QUATRE COUCHES, ET LEUR SENS EST VERROUILLÉ ICI :
//
//   captured   la preuve brute. Ce qui a été capté, y compris ce qui a été
//              écarté — une capture écartée reste une preuve.
//   understood ce que MemorIA a PROPOSÉ. Jamais présenté comme une vérité
//              humaine : c'est une lecture, pas un fait.
//   validated  ce que l'humain a tranché : confirmé, corrigé, ignoré, ou
//              encore en attente. C'est là que la vérité entre.
//   produced   les objets dont la création est PROUVÉE. Rien d'autre.
//
// LA RÈGLE DURE : aucune heuristique temporelle dans `produced`. « Créé pendant
// la visite » n'est pas « créé par la visite » — deux actions saisies à la main
// pendant qu'on marchait sur le chantier ne sont pas le produit du récit. Un
// objet sans provenance démontrable existe au chantier ; il n'est simplement
// pas attribué à cette visite.

/** Ce qui distingue une preuve d'une supposition. Trois niveaux, jamais fondus. */
export type ProvenanceLevel =
  /** Le registre de concrétisation nomme l'objet : la visite l'a créé. */
  | 'registry'
  /** L'objet porte le `report_id` de la visite : rattachement historique,
   *  antérieur au registre. Vrai, mais moins précis. */
  | 'report'

export type ProducedKind = 'action' | 'reserve' | 'decision' | 'echeance' | 'memoire' | 'intervenant'

export interface ProducedObject {
  kind: ProducedKind
  id: string
  label: string
  createdAt: string | null
  provenance: ProvenanceLevel
  /** Section du compte-rendu d'où l'élément venait — registre seulement. */
  sourceSection?: string
  /** Clé stable de l'élément dans sa section — registre seulement. */
  itemKey?: string
}

/** Une entrée du registre porté par les sections du compte-rendu. */
export interface RegistryEntry {
  item_key: string
  entity_type: string
  entity_id: string
  created_at: string
  source_text: string
  sourceSection: string
}

/** Un objet du chantier portant le `report_id` de la visite. */
export interface ReportLinkedObject {
  kind: ProducedKind
  id: string
  label: string
  createdAt: string | null
}

/**
 * Ce que la visite a produit, et à quel titre.
 *
 * Le registre l'emporte : il nomme l'objet et sa section d'origine. Le
 * rattachement par `report_id` complète — il dit « lié à ce compte-rendu »
 * sans pouvoir dire de quelle phrase il est né. Les deux sont vrais ; ils ne
 * disent pas la même chose, et l'écran devra les distinguer.
 *
 * Un objet cité par le registre ET porteur du report_id n'apparaît qu'UNE fois,
 * au niveau le plus fort.
 */
export function classifyProduced(
  registry: RegistryEntry[],
  linked: ReportLinkedObject[],
): ProducedObject[] {
  const out: ProducedObject[] = []
  const seen = new Set<string>()

  for (const entry of registry) {
    const kind = entry.entity_type as ProducedKind
    const key = `${kind}:${entry.entity_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind,
      id: entry.entity_id,
      label: entry.source_text,
      createdAt: entry.created_at,
      provenance: 'registry',
      sourceSection: entry.sourceSection,
      itemKey: entry.item_key,
    })
  }

  for (const obj of linked) {
    const key = `${obj.kind}:${obj.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...obj, provenance: 'report' })
  }

  return out
}

/** Ce que le récit sait, et ce qu'il ne sait pas — dit, jamais masqué. */
export interface NarrativeLimits {
  /** Objets attribués par simple rattachement, faute de registre. */
  historicalAttributions: number
  /** L'intervenant n'a aucun lien à la visite tant que N2 n'est pas livré. */
  intervenantProvenanceMissing: true
}

export function describeLimits(produced: ProducedObject[]): NarrativeLimits {
  return {
    historicalAttributions: produced.filter((p) => p.provenance === 'report').length,
    intervenantProvenanceMissing: true,
  }
}

// ── POURQUOI CET ÉLÉMENT EST-IL LÀ ? (Vincent, 2026-07-21) ──────────────────
//
// Règle de N3, posée dans le read-model et non dans l'écran : chaque ligne du
// récit doit pouvoir expliquer sa présence. Un écran qui affiche sans expliquer
// n'est qu'une liste ; un écran qui explique devient un outil d'audit.
//
// Ces explications sont DÉRIVÉES de faits — un statut, une section, un geste —
// jamais devinées. Quand on ne sait pas, on le dit : c'est la même règle que
// pour la provenance.

/** Un motif lisible par la machine, et sa phrase pour l'humain. */
export interface Reason {
  code: string
  label: string
}

/** Pourquoi cette capture figure dans le récit. */
export function explainCapture(capture: { kept: boolean; intent: string | null }): Reason {
  if (!capture.kept) {
    return { code: 'capture.discarded', label: 'Écartée du compte-rendu par le conducteur' }
  }
  switch (capture.intent) {
    case 'action':
      return { code: 'capture.tagged.action', label: 'Retenue, taguée « action à prévoir »' }
    case 'reserve':
      return { code: 'capture.tagged.reserve', label: 'Retenue, taguée « réserve à lever »' }
    case 'follow':
      return { code: 'capture.tagged.follow', label: 'Retenue, taguée « point à surveiller »' }
    default:
      return { code: 'capture.kept', label: 'Retenue comme élément à conserver' }
  }
}

/** Pourquoi cette proposition figure dans le récit — et ce qu'elle vaut. */
export function explainProposal(proposal: { status: string }): Reason {
  switch (proposal.status) {
    case 'confirmed':
      return { code: 'proposal.confirmed', label: 'Confirmée par un humain' }
    case 'dismissed':
      return { code: 'proposal.dismissed', label: 'Écartée par un humain' }
    case 'superseded':
      // JAMAIS « ignorée » : personne n'a rien décidé. Une analyse plus récente
      // ne redit simplement plus ce fait.
      return { code: 'proposal.superseded', label: 'Devenue obsolète après une nouvelle analyse' }
    default:
      return { code: 'proposal.pending', label: 'Proposée par MemorIA, en attente d’arbitrage' }
  }
}

/** Les titres des sections du compte-rendu, pour une explication lisible. */
const SECTION_LABELS: Record<string, string> = {
  resume: 'Résumé',
  decisions: 'Décisions',
  actions: 'Actions',
  vigilances: 'Points de vigilance',
  a_savoir: 'À savoir',
  echeances: 'Échéances',
  intervenants: 'Intervenants',
}

/** Pourquoi cet objet est réputé PRODUIT par cette visite. */
export function explainProduced(object: ProducedObject): Reason {
  if (object.provenance !== 'registry') {
    return {
      code: 'produced.linked',
      label: 'Rattaché à ce compte-rendu — sa création par cette visite n’est pas démontrable',
    }
  }
  if (object.sourceSection === 'propositions') {
    return { code: 'produced.fromProposal', label: 'Confirmé depuis une proposition MemorIA' }
  }
  const section = SECTION_LABELS[object.sourceSection ?? ''] ?? object.sourceSection
  return {
    code: 'produced.fromDocument',
    label: section
      ? `Créé à partir de la section « ${section} » du compte-rendu`
      : 'Créé à partir du compte-rendu',
  }
}
