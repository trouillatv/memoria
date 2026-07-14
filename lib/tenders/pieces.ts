// Les PIÈCES d'un appel d'offres.
//
// Un AO n'est pas un document : c'est un dossier dont les pièces se répondent.
// Le CCTP décrit ce que le CCAP engage ; le BPU chiffre ce que le CCTP décrit ;
// le RC dit comment répondre. Lire une seule pièce, c'est lire le dossier de
// travers — et c'était exactement ce que faisait le produit (limit 1).
//
// Deux responsabilités, toutes deux PURES (aucune IA, aucun accès réseau) :
//
//   1. Deviner la nature d'une pièce d'après son nom de fichier. Le logiciel
//      PROPOSE — l'utilisateur corrige. Une nature fausse ne casse rien : la
//      pièce est lue quand même, elle est seulement mal nommée à l'écran.
//
//   2. Composer le texte soumis à l'analyse en donnant sa part À CHAQUE pièce.
//      C'est le vrai piège : l'agent tronque à 30 000 caractères
//      (services/ai/initial-analysis.ts). Concaténer bêtement ferait manger tout
//      le budget par le RC — et le CCTP, la pièce qui porte le travail, serait
//      coupée. Une analyse qui n'a jamais vu le CCTP est pire qu'une absence
//      d'analyse : elle est confiante.

import type { TenderPieceKind } from '@/types/db'

export type { TenderPieceKind }

export const TENDER_PIECE_KINDS: readonly TenderPieceKind[] = [
  'rc', 'ccap', 'cctp', 'dpgf', 'bpu', 'plan', 'annexe', 'autre',
]

/** Libellés métier — jamais l'acronyme seul, jamais le mot développeur. */
export const TENDER_PIECE_LABELS: Record<TenderPieceKind, string> = {
  rc: 'Règlement de consultation',
  ccap: 'Clauses administratives (CCAP)',
  cctp: 'Clauses techniques (CCTP)',
  dpgf: 'Décomposition du prix (DPGF)',
  bpu: 'Bordereau des prix (BPU)',
  plan: 'Plans',
  annexe: 'Annexe',
  autre: 'Autre pièce',
}

export function tenderPieceLabel(kind: TenderPieceKind | null): string {
  return kind ? TENDER_PIECE_LABELS[kind] : 'Pièce non qualifiée'
}

/**
 * Nom de fichier → nature de la pièce, ou `null` si le nom ne dit rien.
 *
 * `null` est une réponse LÉGITIME : mieux vaut « pièce non qualifiée » qu'une
 * étiquette inventée. L'utilisateur tranchera.
 */
export function detectPieceKind(filename: string): TenderPieceKind | null {
  // On ramène les séparateurs à des espaces AVANT de chercher des mots entiers :
  // sans ça, « MARCHE_RC_2026 » ne contient aucune frontière de mot autour de RC
  // (l'underscore est un caractère de mot) et le RC passerait inaperçu.
  const name = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-.+()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Les acronymes d'abord (sans ambiguïté), les libellés en toutes lettres
  // ensuite. CCTP avant CCAP : « cahier des clauses » leur est commun.
  if (/\bcctp\b/.test(name) || /clauses? techniques?/.test(name)) return 'cctp'
  if (/\bccap\b/.test(name) || /clauses? administratives?/.test(name)) return 'ccap'
  if (/\bdpgf\b/.test(name) || /decomposition (du )?prix/.test(name)) return 'dpgf'
  if (/\bbpu\b/.test(name) || /bordereau (des )?prix/.test(name)) return 'bpu'
  if (/\brc\b/.test(name) || /reglement (de (la )?)?consultation/.test(name)) return 'rc'
  if (/\bplans?\b/.test(name) || /\bcoupes?\b/.test(name) || /\bfacades?\b/.test(name)) return 'plan'
  if (/\bannexes?\b/.test(name)) return 'annexe'
  return null
}

export interface TenderPiece {
  kind: TenderPieceKind | null
  filename: string
  text: string
}

/** Budget de lecture — aligné sur la troncature de l'agent (30 000 caractères). */
export const TENDER_CORPUS_BUDGET = 30_000

const TRUNCATION_MARK = '\n[… pièce tronquée …]'

/**
 * Répartition « en eau » : chaque pièce reçoit une part égale ; celle qui n'a
 * pas besoin de toute sa part rend le reste, qui est redistribué aux plus
 * grosses. Résultat : les petites pièces (RC, BPU) passent en ENTIER, et seules
 * les grosses (CCTP) sont rognées — jamais supprimées.
 */
function allocate(sizes: number[], budget: number): number[] {
  const given = new Array<number>(sizes.length).fill(0)
  let remaining = Math.max(0, budget)
  let active = sizes.map((_, i) => i).filter((i) => sizes[i] > 0)

  while (active.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / active.length)
    if (share === 0) break
    const stillHungry: number[] = []
    let used = 0
    for (const i of active) {
      const need = sizes[i] - given[i]
      if (need <= share) {
        given[i] += need
        used += need
      } else {
        given[i] += share
        used += share
        stillHungry.push(i)
      }
    }
    remaining -= used
    if (used === 0) break
    active = stillHungry
  }
  return given
}

/**
 * Compose le texte soumis à l'analyse : chaque pièce est ANNONCÉE par son nom,
 * puis citée dans la limite de sa part. L'IA sait ainsi quelle pièce dit quoi —
 * sans cet en-tête, elle attribuerait au CCTP une phrase du RC.
 *
 * Les pièces sans texte (plan non lisible, extraction échouée) sont ignorées du
 * corpus : mieux vaut leur absence qu'un en-tête vide qui laisserait croire
 * qu'elles ont été lues.
 */
export function buildTenderCorpus(pieces: TenderPiece[], budget: number = TENDER_CORPUS_BUDGET): string {
  const readable = pieces.filter((p) => p.text.trim().length > 0)
  if (readable.length === 0) return ''

  const headers = readable.map((p) => `=== ${tenderPieceLabel(p.kind)} — ${p.filename} ===\n`)
  const overhead = headers.reduce((sum, h) => sum + h.length + 2, 0)
  const textBudget = Math.max(0, budget - overhead)

  const texts = readable.map((p) => p.text.trim())
  const given = allocate(texts.map((t) => t.length), textBudget)

  return readable
    .map((_, i) => {
      const full = texts[i]
      const kept = given[i]
      if (kept >= full.length) return headers[i] + full
      // On retire de quoi loger la marque : le lecteur (humain ou IA) doit savoir
      // qu'il lui manque quelque chose plutôt que de croire la pièce complète.
      const room = Math.max(0, kept - TRUNCATION_MARK.length)
      return headers[i] + full.slice(0, room) + TRUNCATION_MARK
    })
    .join('\n\n')
}
