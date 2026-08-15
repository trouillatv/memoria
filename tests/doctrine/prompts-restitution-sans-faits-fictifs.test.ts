// Doctrine transverse — un exemple de prompt ne doit jamais ressembler à une donnée.
//
// Énoncé figé par Vincent le 2026-08-15 :
//
//   « Les prompts de restitution métier ne doivent contenir aucun exemple
//     factuel plausible susceptible d'être confondu avec les données du
//     contexte. Les exemples doivent porter sur la structure de réponse, jamais
//     sur des faits métier fictifs. »
//
// Origine : le diagnostic PETRO du même jour. `SPOKEN_PROMPT_RULES` illustrait
// une consigne de style par « sans changement depuis quatre passages » et
// « revient depuis deux visites ». Le modèle a prononcé ces formules COMME DES
// FAITS, sur des sujets que le contexte donnait explicitement pour modifiés
// l'avant-veille. Un exemple plausible placé dans un prompt de restitution ne
// reste pas un exemple : il devient une source de vérité concurrente du
// contexte, et il gagne, parce qu'il est plus fluide à réutiliser qu'un champ.
//
// Ce que ce test interdit, dans les segments CITÉS des prompts de restitution :
//   — un nombre accolé à une unité métier ("quatre passages", "2 visites") ;
//   — un nom de mois (une date plausible) ;
//   — un code technique de sujet (R4, G3, DN160…), qui désigne des objets réels.
//
// Ce qu'il autorise, et qui est précisément le comportement attendu : les
// exemples de STRUCTURE et les placeholders — "N contrôles", "entre le PV du X
// et le PV du Y", les noms de champs du contexte ("why", "lastKnown"). Un
// placeholder ne peut pas être confondu avec une donnée : c'est toute la
// différence.
//
// Périmètre : les prompts de RESTITUTION (ceux qui parlent des données du
// chantier à l'utilisateur). Les prompts d'extraction ou de classification en
// sont exclus : un exemple d'entrée y est légitime, et leurs placeholders
// structurels (T1/T2 dans le classificateur d'évolution) tomberaient à tort
// sous le motif « code technique ». Étendre la doctrine = ajouter un fichier à
// `RESTITUTION_PROMPT_FILES`.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const RESTITUTION_PROMPT_FILES = [
  'lib/visits/copilot-answer.ts',
  'lib/visits/copilot-free-answer.ts',
]

/** Constantes de prompt : littéraux gabarits nommés PROMPT / RULES / SYSTEM. */
const PROMPT_CONST = /const\s+([A-Z_]*(?:PROMPT|RULES|SYSTEM)[A-Z_]*)\s*(?::[^=]*)?=\s*`([\s\S]*?)`/g
/** Les consignes par intention sont un objet de chaînes, pas un gabarit. */
const INTENT_BLOCK = /const\s+INTENT_PROMPTS[\s\S]*?\n\}/

/** Segments présentés comme des citations dans le prompt : "…" ou «…». */
const QUOTED = /"([^"\n]{2,300})"|«([^»\n]{2,300})»/g

const FABRICATED = [
  {
    label: 'un nombre accolé à une unité métier',
    re: /\b\d+\s*(jours?|semaines?|mois|visites?|passages?|sujets?|actions?|réserves?|contrôles?|heures?|h\b)/i,
  },
  {
    label: 'un nom de mois (date plausible)',
    re: /\b(janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i,
  },
  {
    label: 'un code technique de sujet',
    re: /\b[A-Z]{1,3}\d{1,3}\b/,
  },
]

type Segment = { file: string; constName: string; quote: string }

function quotedSegmentsOf(file: string): Segment[] {
  const src = read(file)
  const blocks: { constName: string; body: string }[] = []

  for (const m of src.matchAll(PROMPT_CONST)) {
    blocks.push({ constName: m[1], body: m[2] })
  }
  const intents = src.match(INTENT_BLOCK)
  if (intents) blocks.push({ constName: 'INTENT_PROMPTS', body: intents[0] })

  const out: Segment[] = []
  for (const b of blocks) {
    for (const q of b.body.matchAll(QUOTED)) {
      out.push({ file, constName: b.constName, quote: q[1] ?? q[2] })
    }
  }
  return out
}

describe('Doctrine — aucun fait fictif dans les prompts de restitution', () => {
  const segments = RESTITUTION_PROMPT_FILES.flatMap(quotedSegmentsOf)

  it('le harnais lit réellement des prompts (sinon il passerait à vide)', () => {
    // Sans cette garde, un renommage de constante rendrait le test vert en
    // n'inspectant plus rien — le pire état possible pour un garde-fou.
    expect(segments.length).toBeGreaterThan(10)
    expect(new Set(segments.map((s) => s.file)).size).toBe(RESTITUTION_PROMPT_FILES.length)
  })

  it.each(FABRICATED)('aucun exemple ne contient $label', ({ re }) => {
    const faulty = segments.filter((s) => re.test(s.quote))
    expect(faulty.map((s) => `${s.file} · ${s.constName} · "${s.quote}"`)).toEqual([])
  })
})

describe('Doctrine — la hiérarchie orale appartient au moteur', () => {
  // Contrepartie positive : interdire les faux faits ne suffit pas, encore
  // faut-il que le prompt impose l'ordre calculé. « MemorIA décide de
  // l'attention. L'IA formule l'attention. » (Vincent, 2026-08-15)
  //
  // Lu depuis la source et non importé : `copilot-answer.ts` est `server-only`.
  const src = read('lib/visits/copilot-answer.ts')
  const SPOKEN_PROMPT_RULES =
    src.match(/const SPOKEN_PROMPT_RULES\s*=\s*`([\s\S]*?)`/)?.[1] ?? ''

  it('le contrat oral est bien extrait de la source', () => {
    expect(SPOKEN_PROMPT_RULES.length).toBeGreaterThan(200)
  })

  it('la voix doit annoncer COMBIEN d’éléments existent', () => {
    expect(SPOKEN_PROMPT_RULES).toMatch(/annonce d'abord COMBIEN/)
  })

  it('la voix doit suivre l’ordre reçu, sans sélection libre', () => {
    expect(SPOKEN_PROMPT_RULES).toMatch(/dans l'ordre donné/)
    expect(SPOKEN_PROMPT_RULES).toMatch(/tu ne choisis pas librement/)
  })

  it('interdit les formules de récurrence non établies par le contexte', () => {
    expect(SPOKEN_PROMPT_RULES).toMatch(/AUCUNE formule de récurrence/)
  })
})
