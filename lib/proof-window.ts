// FENÊTRE DE PREUVE — couche PURE (aucun import server, testable en CI).
//
// Doctrine (Vincent 2026-07-09) : toute preuve a une DATE LIMITE DE CAPTURE.
// Certains travaux ont une CONSÉQUENCE PHYSIQUE irréversible pour l'observation
// (recouvrir, cacher, enterrer, sceller) : après, la photo de l'existant devient
// IMPOSSIBLE — aucune IA, aucun litige, aucun budget ne rouvrira le béton.
//
// MODÈLE (Vincent 2026-07-10) : pas un moteur lexical mais un moteur MÉTIER —
//   type d'opération → conséquence physique → fenêtre de preuve.
// Le lexique n'est que la V1 du MATCHING (comment on reconnaît l'opération) ;
// la conséquence est le CONCEPT (pourquoi la fenêtre se ferme, quel wording).
// Demain le matching pourra venir d'un type d'intervention structuré sans
// toucher au reste. Fondé sur des FAITS DÉCLARÉS (interventions planifiées,
// actions à échéance) — jamais une inférence.
//
// Garde-fous : précision >> rappel (lexique volontairement étroit — un faux
// signal coûte la confiance) ; wording calme, opportunité jamais reproche ;
// 100 % déterministe (zéro LLM) ; source explicable.
import type { MemorySignal, SignalItem } from '@/lib/db/site-memory-signals'

/** Conséquence physique d'une opération sur l'OBSERVABILITÉ de l'existant. */
export type OcclusionConsequence = 'recouvre' | 'cache' | 'enterre' | 'scelle'

/** Ce que la conséquence rend impossible — le POURQUOI montré à l'utilisateur. */
export const CONSEQUENCE_WORDING: Record<OcclusionConsequence, string> = {
  recouvre: 'ce qui est dessous ne sera plus visible',
  cache: 'ce qui est derrière ne sera plus visible',
  enterre: 'ce qui est dessous sera enterré',
  scelle: 'l’ouverture sera refermée',
}

/** Opérations reconnues (formes normalisées : minuscules, sans accents) → leur
 *  conséquence physique. Étroit à dessein : on préfère rater un « fermeture de
 *  gaine » ambigu que signaler un « nettoyage de la dalle ». S'enrichit par
 *  CONSTAT terrain (et demain : par un type d'opération structuré, pas des mots). */
export const OCCLUSION_LEXICON: { term: string; consequence: OcclusionConsequence }[] = [
  // Recouvrement horizontal (béton, sols)
  { term: 'coulage', consequence: 'recouvre' },
  { term: 'betonnage', consequence: 'recouvre' },
  { term: 'chape', consequence: 'recouvre' },
  { term: 'ragreage', consequence: 'recouvre' },
  { term: 'coffrage', consequence: 'recouvre' },
  // Masquage vertical / plafonds (parois rapportées)
  { term: 'doublage', consequence: 'cache' },
  { term: 'cloisonnement', consequence: 'cache' },
  { term: 'contre-cloison', consequence: 'cache' },
  { term: 'faux plafond', consequence: 'cache' },
  { term: 'faux-plafond', consequence: 'cache' },
  { term: 'plafond suspendu', consequence: 'cache' },
  { term: 'flocage', consequence: 'cache' },
  { term: 'bardage', consequence: 'cache' },
  { term: 'habillage', consequence: 'cache' },
  // Enfouissement (réseaux, tranchées)
  { term: 'remblai', consequence: 'enterre' },
  { term: 'remblaiement', consequence: 'enterre' },
  { term: 'enfouissement', consequence: 'enterre' },
  { term: 'enrobe', consequence: 'enterre' },
  // Scellement (réservations, trémies)
  { term: 'rebouchage', consequence: 'scelle' },
  { term: 'calfeutrement', consequence: 'scelle' },
]

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export interface OcclusionMatch {
  term: string
  consequence: OcclusionConsequence
}

/** Opération de recouvrement reconnue dans un intitulé (ou null). Frontière de
 *  mot côté gauche pour éviter les inclusions accidentelles (« écoulement » ≠
 *  « coulage »). */
export function occlusionMatch(label: string): OcclusionMatch | null {
  const n = normalize(label)
  for (const { term, consequence } of OCCLUSION_LEXICON) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-\s]/g, '[-\\s]')}`)
    if (re.test(n)) return { term, consequence }
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
    .map((c) => ({ ...c, match: occlusionMatch(c.label) }))
    .filter((c): c is ProofWindowCandidate & { match: OcclusionMatch } => c.match !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (closing.length === 0) return null
  const items: SignalItem[] = closing.map((c) => {
    const inDays = daysBetween(asOf, c.date)
    const when = inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : `dans ${inDays} j (le ${ddmmyyyy(c.date)})`
    return {
      id: c.id,
      label: c.label,
      meta: `${c.origin === 'intervention' ? 'intervention prévue' : 'échéance'} ${when} · ${c.match.term} — ${c.match.consequence}`,
      context: [
        `Après, ${CONSEQUENCE_WORDING[c.match.consequence]} — les photos se prennent AVANT le ${ddmmyyyy(c.date)}.`,
        openReserveCount > 0
          ? `${openReserveCount} réserve${openReserveCount > 1 ? 's' : ''} encore ouverte${openReserveCount > 1 ? 's' : ''} sur le chantier — l'une concerne-t-elle la zone touchée ?`
          : null,
      ].filter((x): x is string => !!x),
    }
  })
  return {
    kind: 'proof_window_closing',
    title: `${closing.length} fenêtre${closing.length > 1 ? 's' : ''} de preuve se referme${closing.length > 1 ? 'nt' : ''} sous ${horizonDays} j`,
    items,
    source:
      'Interventions planifiées et actions à échéance (≤ 7 j) dont l’opération recouvre, cache, enterre ou scelle l’existant. La preuve se prend avant — après, elle est physiquement impossible.',
  }
}
