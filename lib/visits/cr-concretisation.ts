// CONCRÉTISER — transformer le récit approuvé en travail réel (Vincent, 2026-07-21).
//
//   Modifier   corrige le récit.
//   Valider    approuve le récit.
//   Concrétiser  transforme ce récit approuvé en objets du chantier.
//
// Ce module fait le premier temps de la concrétisation, et lui seul : LIRE le
// document corrigé et en sortir la liste des éléments à créer. Il ne crée rien.
// L'humain confirme d'abord, écran de revue à l'appui.
//
// LA RÈGLE CARDINALE : on lit `content`, JAMAIS `ai_content`, jamais l'ancien
// débrief. La proposition d'origine peut être obsolète ; ce que Guillaume a
// corrigé fait foi. Concrétiser depuis l'analyse initiale reviendrait à créer
// dans le chantier ce qu'il vient précisément de corriger.
//
// Cinq familles concrétisables — et cinq seulement :
//   décisions · actions · échéances · intervenants · mémoire (« à savoir »).
// Le RÉSUMÉ et les VIGILANCES racontent ; ils ne créent rien. Un point de
// vigilance qui mérite un objet doit devenir une action ou une réserve, par un
// geste humain explicite — pas par une conversion automatique.
//
// Module PUR : aucune base, aucun réseau. Testable, et lisible des deux côtés.

import type { ReportDocumentSection } from '@/types/db'

export type OperationalKind = 'decision' | 'action' | 'echeance' | 'intervenant' | 'memoire'

export interface OperationalItem {
  /** Clé STABLE (famille + rang) : cocher/décocher doit survivre à un rendu. */
  key: string
  kind: OperationalKind
  /** Ce qu'on lira dans le chantier — le texte corrigé, tel quel. */
  label: string
  /** Responsable dit. `null` si le texte n'en nomme pas : on n'attribue jamais. */
  owner: string | null
  /** Date DITE (AAAA-MM-JJ). Jamais déduite d'un délai. */
  due: string | null
  /** Contrainte dite (« Avant le démarrage ») quand il n'y a pas de date. */
  constraint: string | null
  /** D'où vient l'élément dans le document — la provenance ne se perd pas. */
  sourceSection: string
}

/** Les sections qui produisent des objets, et ce qu'elles produisent. */
const CONCRETISABLE: Record<string, OperationalKind> = {
  decisions: 'decision',
  actions: 'action',
  echeances: 'echeance',
  intervenants: 'intervenant',
  a_savoir: 'memoire',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Les puces d'une section, nettoyées. Une ligne vide ne produit rien. */
function bulletsOf(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/**
 * Relit une ligne écrite par la conversion (`Titre — Responsable, pour le DATE`
 * ou `Titre — Contrainte`) SANS jamais rien inventer : ce que le texte ne dit
 * pas reste `null`. Une ligne corrigée à la main qui ne suit plus ce gabarit
 * reste un libellé entier — on préfère un titre long à une donnée fabriquée.
 */
function readLine(raw: string): { label: string; owner: string | null; due: string | null; constraint: string | null } {
  const [head, ...rest] = raw.split('—')
  const label = (head ?? '').trim()
  const tail = rest.join('—').trim()
  if (!tail) return { label, owner: null, due: null, constraint: null }

  let owner: string | null = null
  let due: string | null = null
  let constraint: string | null = null

  for (const part of tail.split(',').map((p) => p.trim()).filter(Boolean)) {
    const date = part.match(/^pour le\s+(\d{4}-\d{2}-\d{2})$/)
    if (date) {
      due = date[1]!
      continue
    }
    if (ISO_DATE.test(part)) {
      due = part
      continue
    }
    if (owner === null && constraint === null && /^[A-ZÀ-Ý]/.test(part) === false) {
      constraint = part
      continue
    }
    // Un mot capitalisé isolé après le tiret : un nom. Une phrase : une
    // contrainte dite. On ne tranche que sur ce que la forme montre.
    if (owner === null && part.split(/\s+/).length <= 2 && /^[A-ZÀ-Ý]/.test(part)) owner = part
    else constraint = constraint ? `${constraint}, ${part}` : part
  }

  return { label, owner, due, constraint }
}

/**
 * Les éléments concrétisables du document CORRIGÉ, dans l'ordre de lecture.
 * Ne crée rien : produit la matière de l'écran de revue, que l'humain confirme.
 */
export function readOperationalItems(sections: ReportDocumentSection[]): OperationalItem[] {
  const items: OperationalItem[] = []
  for (const section of sections ?? []) {
    const kind = CONCRETISABLE[section.key]
    if (!kind) continue // résumé et vigilances racontent — ils ne créent pas
    bulletsOf(section.content ?? '').forEach((line, index) => {
      const read = readLine(line)
      if (!read.label) return
      items.push({
        key: `${kind}:${index}`,
        kind,
        label: read.label,
        owner: read.owner,
        due: read.due,
        constraint: read.constraint,
        sourceSection: section.key,
      })
    })
  }
  return items
}

// ── CE QUE MES CORRECTIONS ONT CHANGÉ ───────────────────────────────────────
//
// « Reprends mon texte et refais l'analyse » (Vincent, 2026-07-21). Le geste
// utile n'est pas de restaurer l'ancienne proposition — c'est de RELIRE le
// texte corrigé et de dire ce qui a bougé depuis. On compare donc ce que
// produit `content` à ce que produisait la proposition d'origine (`ai_content`),
// et on nomme la différence : nouvelles, disparues, modifiées.
//
// Déterministe et traçable : aucune inférence, aucun appel LLM. Chaque ligne du
// diff vient d'un texte que Guillaume a sous les yeux.

export interface OperationalDiff {
  /** Ce que le texte corrigé fait apparaître et que l'IA n'avait pas proposé. */
  added: OperationalItem[]
  /** Ce que l'IA proposait et que les corrections ont fait disparaître. */
  removed: OperationalItem[]
  /** Même élément, complément changé (responsable, date, contrainte). */
  changed: Array<{ before: OperationalItem; after: OperationalItem }>
  /** Rien n'a bougé : le texte corrigé produit exactement la même chose. */
  unchanged: boolean
}

const sameLabel = (a: OperationalItem, b: OperationalItem) =>
  a.kind === b.kind && a.label.trim().toLowerCase() === b.label.trim().toLowerCase()

const sameDetail = (a: OperationalItem, b: OperationalItem) =>
  a.owner === b.owner && a.due === b.due && a.constraint === b.constraint

/** Les sections telles que MemorIA les avait proposées — pour la comparaison. */
export function asProposedSections(sections: ReportDocumentSection[]): ReportDocumentSection[] {
  return sections.map((s) => ({ ...s, content: s.ai_content ?? s.content }))
}

/** Ce que les corrections ont changé, famille par famille. */
export function diffOperationalItems(
  before: OperationalItem[],
  after: OperationalItem[],
): OperationalDiff {
  const added: OperationalItem[] = []
  const changed: Array<{ before: OperationalItem; after: OperationalItem }> = []
  const matched = new Set<OperationalItem>()

  for (const item of after) {
    const twin = before.find((b) => !matched.has(b) && sameLabel(b, item))
    if (!twin) {
      added.push(item)
      continue
    }
    matched.add(twin)
    if (!sameDetail(twin, item)) changed.push({ before: twin, after: item })
  }

  const removed = before.filter((b) => !matched.has(b))
  return { added, removed, changed, unchanged: added.length + removed.length + changed.length === 0 }
}

// ── L'ANTI-DOUBLON ──────────────────────────────────────────────────────────
//
// Créer deux fois la même action parce qu'on a recliqué, ou parce qu'un second
// onglet est passé avant, serait la pire trahison de ce parcours : le chantier
// se remplirait de jumeaux que personne n'a demandés.
//
// La signature est le couple (famille, libellé normalisé). Elle vaut pour la
// comparaison avec ce qui existe DÉJÀ dans le chantier, et à l'intérieur d'un
// même envoi : deux lignes identiques ne créent qu'un objet.

/** L'identité d'un élément aux yeux de l'anti-doublon. */
export function signatureOf(item: Pick<OperationalItem, 'kind' | 'label'>): string {
  return `${item.kind}:${item.label.trim().toLowerCase()}`
}

/**
 * Ce qui reste à créer, une fois retiré ce qui existe déjà — et une fois retirés
 * les doublons internes à la sélection elle-même.
 */
export function toCreate(
  items: OperationalItem[],
  existing: Set<string>,
): { create: OperationalItem[]; skipped: OperationalItem[] } {
  const seen = new Set(existing)
  const create: OperationalItem[] = []
  const skipped: OperationalItem[] = []
  for (const item of items) {
    const sig = signatureOf(item)
    if (seen.has(sig)) {
      skipped.push(item)
      continue
    }
    seen.add(sig)
    create.push(item)
  }
  return { create, skipped }
}

// ── L'IDENTITÉ DURABLE D'UN ÉLÉMENT CONCRÉTISÉ ──────────────────────────────
//
// Le libellé normalisé protège du double-clic et de la relance à l'identique.
// Il ne protège PAS de la suite : corriger le texte d'une action déjà créée la
// rendrait méconnaissable, et une relance la recréerait. Or corriger le CR est
// justement la fonction centrale du produit — la faille est donc sur le chemin
// le plus fréquenté.
//
// L'identité durable vit dans le REGISTRE porté par la section (jsonb, aucune
// migration) : une clé stable, le type et l'identifiant de l'objet créé, et le
// texte d'alors. La reconnaissance se fait en cascade :
//
//   1. même texte      → c'est le même élément, rien n'a bougé ;
//   2. même clé stable → c'est le même élément, SON TEXTE A CHANGÉ ;
//   3. rien            → élément neuf.
//
// Le cas 2 ne déclenche AUCUNE mise à jour automatique : on affiche l'écart et
// on rend la main. Réécrire un objet du chantier parce qu'un mot a bougé dans un
// compte-rendu serait une décision prise à la place de l'humain.

import type { SectionConcretisation } from '@/types/db'

export interface ConcretisationMatch {
  entry: SectionConcretisation
  /** Le texte du CR a changé depuis la création de l'objet. */
  textChanged: boolean
}

/** Reconnaît un élément déjà concrétisé, par texte puis par clé stable. */
export function matchConcretisation(
  item: Pick<OperationalItem, 'kind' | 'label' | 'key'>,
  registry: SectionConcretisation[] | undefined,
): ConcretisationMatch | null {
  const entries = (registry ?? []).filter((e) => e.entity_type === item.kind)
  if (entries.length === 0) return null

  const label = item.label.trim().toLowerCase()
  const sameText = entries.find((e) => e.source_text.trim().toLowerCase() === label)
  if (sameText) return { entry: sameText, textChanged: false }

  const sameKey = entries.find((e) => e.item_key === item.key)
  if (sameKey) return { entry: sameKey, textChanged: true }

  return null
}

/** Inscrit une création au registre de sa section, sans toucher au texte. */
export function withConcretisation(
  sections: ReportDocumentSection[],
  sectionKey: string,
  entry: SectionConcretisation,
): ReportDocumentSection[] {
  return sections.map((s) =>
    s.key === sectionKey ? { ...s, concretisations: [...(s.concretisations ?? []), entry] } : { ...s },
  )
}
