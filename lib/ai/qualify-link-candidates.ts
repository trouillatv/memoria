// Qualification LLM des paires candidates de relations inter-sujets.
//
// Doctrine V1 :
//   - La cooccurrence seule ≠ relation métier
//   - Relation directionnelle uniquement si explicitement prouvée par les extraits
//   - La preuve doit venir des extraits fournis, pas d'une connaissance réglementaire externe
//   - no_relation préféré à une relation incertaine
//   - Jamais confirmed — toujours suggested
//
// Distinctions critiques (calibration 2026-08-08) :
//
// 1. semanticEvidence vs cooccurrenceEvidence
//   semanticEvidence    : les extraits contiennent des éléments reliant réellement A et B
//                         (même objet physique, lien documentaire explicite, dépendance textuelle)
//   cooccurrenceEvidence: A et B sont simplement présents dans le même document
//                         (ex. "Plan de VRD ; VISA FAIT" côté à côté avec un autre sujet)
//   → Une relation ne doit jamais devenir suggested sur la seule base de cooccurrenceEvidence,
//     quelle que soit la confiance déclarée par le LLM.
//   → La confiance LLM n'est pas une probabilité de vérité. Un score de 0.80 produit par Gemini
//     ne signifie pas « 80 % de chances que cette relation existe ». C'est un score déclaratif.
//     Le pipeline doit contrôler la qualité de la preuve, pas seulement le chiffre.
//
// 2. Règle anti-contingence (calibration 2026-08-08, issue de l'audit du lien [7])
//   Une formulation contingente n'est PAS une dépendance directionnelle.
//   Exemples de contingence (→ relates_to ou no_relation, jamais directionnel) :
//     "Y à prévoir si X n'est pas fait"  → scénario de repli, pas X enables Y
//     "si les éprouvettes ne sont pas effectués → carottage"  → pas enables
//     "en cas de retard, prévoir X"  → pas requires
//   Un type directionnel (requires/enables/causes/validates/replaces) exige une formulation
//   explicite de préalable ou de déclenchement dans les preuves :
//     "A est nécessaire avant B", "B démarre après validation de A", "A permet de poursuivre B"
//   Une chronologie seule, une contingence, ou une simple proximité sémantique ne suffisent pas.
//
// Différence avec suggestDependenciesForRun (suggest-dependencies.ts) :
//   - Cette fonction qualifie UNE SEULE PAIRE à la fois
//   - Le contexte est multi-PV (preuves issues de plusieurs occurrences communes)
//   - Types élargis : no_relation + relates_to autorisés

import { z } from 'zod'

// ── Types publics ─────────────────────────────────────────────────────────────

export const LINK_TYPES_ALL = [
  'no_relation', 'relates_to',
  'requires', 'enables', 'causes', 'validates', 'replaces',
] as const
export type LinkTypeAll = (typeof LINK_TYPES_ALL)[number]

export const DIRECTIONS = ['A_to_B', 'B_to_A', 'undirected', 'none'] as const
export type Direction = (typeof DIRECTIONS)[number]

export interface PairEvidence {
  runId:     string
  runDate:   string
  excerptA:  string   // extrait du sujet A dans ce run
  excerptB:  string   // extrait du sujet B dans ce run
  proposalIdA: string
  proposalIdB: string
}

export interface CandidatePair {
  csIdA:   string; labelA: string; famA: string
  csIdB:   string; labelB: string; famB: string
  countA:  number; countB: number; countAB: number; N: number
  lift:    number; confAB: number; confBA: number
  evidence: PairEvidence[]   // max 4 entrées — les plus récentes/représentatives
}

export interface QualificationResult {
  linkType:    LinkTypeAll
  direction:   Direction
  fromId:      string | null   // null pour no_relation / relates_to
  toId:        string | null
  confidence:  number
  justification: string
  evidenceRunIds: string[]
}

// ── Gemini schema ─────────────────────────────────────────────────────────────

const GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    linkType:      { type: 'string', enum: [...LINK_TYPES_ALL] },
    direction:     { type: 'string', enum: [...DIRECTIONS] },
    confidence:    { type: 'number' },
    justification: { type: 'string' },
  },
  required: ['linkType', 'direction', 'confidence', 'justification'],
}

const ResultSchema = z.object({
  linkType:      z.enum(LINK_TYPES_ALL),
  direction:     z.enum(DIRECTIONS),
  confidence:    z.number().min(0).max(1),
  justification: z.string().min(1),
})

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(pair: CandidatePair): string {
  const freqA = ((pair.countA / pair.N) * 100).toFixed(0)
  const freqB = ((pair.countB / pair.N) * 100).toFixed(0)

  const evidenceBlock = pair.evidence
    .map((e, i) =>
      `[PV ${i + 1} — ${e.runDate}]\n` +
      `  A : "${e.excerptA.slice(0, 250)}"\n` +
      `  B : "${e.excerptB.slice(0, 250)}"`
    )
    .join('\n\n')

  return `Tu qualifies la relation potentielle entre deux sujets d'un chantier BTP.
Ta qualification détermine si une suggestion de relation est créée dans la base — sois rigoureux.

══════════════════════════════════════════════════════════
SUJET A : "${pair.labelA}"
Type sémantique : ${pair.famA}
Fréquence : ${pair.countA}/${pair.N} PVs (${freqA} %)

SUJET B : "${pair.labelB}"
Type sémantique : ${pair.famB}
Fréquence : ${pair.countB}/${pair.N} PVs (${freqB} %)

SIGNAL STATISTIQUE :
- Co-présents dans ${pair.countAB}/${pair.N} PVs
- Lift : ${pair.lift.toFixed(2)}  (1.0 = niveau du hasard)
- Conf. A→B : ${pair.confAB.toFixed(2)}  /  Conf. B→A : ${pair.confBA.toFixed(2)}

══════════════════════════════════════════════════════════
PREUVES — extraits des ${pair.evidence.length} PV(s) commun(s) :

${evidenceBlock}

══════════════════════════════════════════════════════════
MISSION : Qualifie la nature de la relation entre A et B en te basant UNIQUEMENT sur les preuves ci-dessus.

TYPES AUTORISÉS :
  no_relation  — les sujets cooccurrent sans lien identifiable dans les textes
  relates_to   — association documentée mais non orientée (même phase, même contexte)
  requires     — A ne peut pas avancer sans B (A dépend de B)
  enables      — A permet ou déclenche B
  causes       — A provoque directement B (causalité explicite)
  validates    — A valide, qualifie ou lève une réserve sur B
  replaces     — A rend B obsolète ou le remplace formellement

DIRECTION (uniquement pour requires/enables/causes/validates/replaces) :
  A_to_B  : A est la source — ex. "A requires B" signifie A a besoin de B
  B_to_A  : B est la source
  undirected : pour relates_to uniquement
  none       : pour no_relation uniquement

RÈGLES ABSOLUES — respecter sans exception :
1. La cooccurrence seule N'EST PAS une relation métier.
2. Un type directionnel (requires/enables/causes/validates/replaces) exige une preuve textuelle explicite d'ordre, de condition ou de conséquence.
3. Si la relation est plausible mais non prouvée par les extraits → utilise relates_to.
4. N'utilise aucune connaissance réglementaire ou sectorielle absente des extraits fournis.
5. Si confidence < 0.70 → choisir no_relation ou relates_to, jamais un type directionnel.
6. Préfère no_relation à une relation incertaine ou tacite.
7. justification : cite l'élément textuel exact (≤ 200 caractères). Si no_relation, explique pourquoi les extraits ne prouvent aucun lien.`
}

// ── Appel Gemini ──────────────────────────────────────────────────────────────

export async function qualifyLinkCandidate(pair: CandidatePair): Promise<QualificationResult | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    console.error('  [qualify] GOOGLE_GENAI_API_KEY manquante')
    return null
  }
  if (pair.evidence.length === 0) {
    console.error('  [qualify] Aucune preuve disponible pour cette paire')
    return null
  }

  const model  = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const prompt = buildPrompt(pair)

  try {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.error(`  [qualify] HTTP ${resp.status}:`, text.slice(0, 200))
      return null
    }

    const json = await resp.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) { console.error('  [qualify] Réponse vide'); return null }

    const parsed = ResultSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error('  [qualify] Parse error:', parsed.error.issues[0]?.message)
      return null
    }

    const { linkType, direction, confidence, justification } = parsed.data

    // Résolution de la direction en from/to
    let fromId: string | null = null
    let toId:   string | null = null
    if (direction === 'A_to_B') { fromId = pair.csIdA; toId = pair.csIdB }
    if (direction === 'B_to_A') { fromId = pair.csIdB; toId = pair.csIdA }

    return {
      linkType,
      direction,
      fromId,
      toId,
      confidence,
      justification,
      evidenceRunIds: pair.evidence.map(e => e.runId),
    }
  } catch (e) {
    console.error('  [qualify] Exception:', e)
    return null
  }
}
