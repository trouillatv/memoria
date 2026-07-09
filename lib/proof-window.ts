// FENÊTRE DE PREUVE — couche PURE (aucun import server, testable en CI).
//
// Doctrine (Vincent 2026-07-09) : toute preuve a une DATE LIMITE DE CAPTURE.
// Certains travaux recouvrent physiquement ce qu'ils touchent (coulage, doublage,
// remblai…) : après, la photo de ce qui est dessous/derrière devient IMPOSSIBLE —
// aucune IA, aucun litige, aucun budget ne rouvrira le béton. Ce module détecte
// les fenêtres qui se referment sous N jours à partir de FAITS DÉCLARÉS
// (interventions planifiées, actions à échéance) — jamais une inférence.
//
// Garde-fous : précision >> rappel (lexique volontairement étroit — un faux
// signal coûte la confiance) ; wording calme, opportunité jamais reproche ;
// 100 % déterministe (zéro LLM) ; source explicable.
import type { MemorySignal, SignalItem } from '@/lib/db/site-memory-signals'

/** Travaux qui RECOUVRENT (formes normalisées : minuscules, sans accents).
 *  Étroit à dessein : on préfère rater un « fermeture de gaine » ambigu que
 *  signaler un « nettoyage de la dalle ». S'enrichit par CONSTAT terrain. */
export const OCCLUSION_TERMS: string[] = [
  'coulage', 'betonnage', 'chape', 'remblai', 'remblaiement', 'enrobe',
  'enfouissement', 'doublage', 'cloisonnement', 'contre-cloison',
  'faux plafond', 'faux-plafond', 'plafond suspendu', 'flocage',
  'ragreage', 'rebouchage', 'calfeutrement', 'bardage', 'coffrage', 'habillage',
]

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Terme de recouvrement présent dans un intitulé (ou null). Frontière de mot
 *  côté gauche pour éviter les inclusions accidentelles (« écoulement » ≠ « coulage »). */
export function occlusionTerm(label: string): string | null {
  const n = normalize(label)
  for (const term of OCCLUSION_TERMS) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-\s]/g, '[-\\s]')}`)
    if (re.test(n)) return term
  }
  return null
}

/** Un événement daté susceptible de fermer une fenêtre (fait déclaré). */
export interface ProofWindowCandidate {
  id: string
  label: string
  /** Date ISO (yyyy-mm-dd) du fait déclaré : scheduled_for ou due_date. */
  date: string
  origin: 'intervention' | 'action'
}

function ddmmyyyy(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
}

/** Construit le signal « fenêtres de preuve » à partir d'événements pré-chargés.
 *  PURE : la partie DB vit dans lib/db/site-memory-signals.ts. */
export function buildProofWindowSignal(
  candidates: ProofWindowCandidate[],
  openReserveCount: number,
  asOf: string,
  horizonDays = 7,
): MemorySignal | null {
  const closing = candidates
    .filter((c) => c.date >= asOf && daysBetween(asOf, c.date) <= horizonDays)
    .map((c) => ({ ...c, term: occlusionTerm(c.label) }))
    .filter((c): c is ProofWindowCandidate & { term: string } => c.term !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (closing.length === 0) return null
  const items: SignalItem[] = closing.map((c) => {
    const inDays = daysBetween(asOf, c.date)
    const when = inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : `dans ${inDays} j (le ${ddmmyyyy(c.date)})`
    return {
      id: c.id,
      label: c.label,
      meta: `${c.origin === 'intervention' ? 'intervention prévue' : 'échéance'} ${when} · recouvrement : ${c.term}`,
      context: [
        `Après, ce qui est dessous/derrière ne sera plus visible — les photos se prennent AVANT le ${ddmmyyyy(c.date)}.`,
        openReserveCount > 0
          ? `${openReserveCount} réserve${openReserveCount > 1 ? 's' : ''} encore ouverte${openReserveCount > 1 ? 's' : ''} sur le chantier — l'une concerne-t-elle la zone recouverte ?`
          : null,
      ].filter((x): x is string => !!x),
    }
  })
  return {
    kind: 'proof_window_closing',
    title: `${closing.length} fenêtre${closing.length > 1 ? 's' : ''} de preuve se referme${closing.length > 1 ? 'nt' : ''} sous ${horizonDays} j`,
    items,
    source:
      'Interventions planifiées et actions à échéance (≤ 7 j) dont l’intitulé indique un recouvrement (coulage, doublage, remblai…). La preuve de l’existant se prend avant — après, elle est physiquement impossible.',
  }
}
