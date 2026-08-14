// Copilote V2 — couche de compréhension.
//
// Ce fichier prouve trois choses distinctes :
//   1. La couche est ROBUSTE : LLM absent, lent, en erreur ou incohérent → le
//      pipeline déterministe reprend la main, silencieusement.
//   2. Elle ne peut JAMAIS provoquer une mutation : au mieux un brouillon soumis
//      à validation humaine. Une question reste une question.
//   3. Sur un corpus de formulations orales dégradées, la fusion produit la
//      bonne famille de lecture — et le repli déterministe reste cohérent.
//
// Ce que ce fichier NE prouve PAS : la justesse du LLM lui-même. Les
// compréhensions sont ici SIMULÉES (elles décrivent ce que le prompt exige).
// La justesse réelle relève de la recette PETRO ATITI.

import { describe, it, expect } from 'vitest'
import {
  understandQuestion,
  parseComprehension,
  sanitizeEntities,
  mergeComprehension,
  type Comprehension,
  type ComprehensionLabel,
} from '@/lib/visits/copilot-comprehension'
import { classifyIntent } from '@/lib/visits/copilot-classify'
import { detectIntent } from '@/lib/visits/copilot-intent-router'
import { resolveQuantitativeVerdict } from '@/lib/visits/copilot-context'
import type { AIProvider, CompletionOutput } from '@/services/ai'

// ── Helpers ───────────────────────────────────────────────────────────────────

function provider(impl: () => Promise<CompletionOutput>): AIProvider {
  return { name: 'mock', complete: impl }
}

function output(parsed: unknown, text = ''): CompletionOutput {
  return { text, parsed, tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1 }
}

function comprehension(
  label: ComprehensionLabel,
  over: Partial<Comprehension> = {},
): Comprehension {
  const mode = label === 'POSSIBLE_WRITE' ? 'possible_write' : label === 'UNKNOWN' ? 'unknown' : 'read'
  return {
    mode,
    label,
    intent: 'other',
    entities: [],
    timeScope: 'none',
    confidence: 'high',
    ...over,
  }
}

/** Rejoue le pipeline complet (déterministe + fusion) sans toucher à la base. */
function route(question: string, c: Comprehension | null) {
  return mergeComprehension(question, classifyIntent(question), detectIntent(question), c)
}

// ── 1. Garde anti-hallucination ───────────────────────────────────────────────

describe('sanitizeEntities — le LLM ne peut pas introduire un sujet absent', () => {
  it("rejette une entité qui n'est pas dans la question (défaut G3 sur PETRO ATITI)", () => {
    expect(sanitizeEntities('Où en est le chantier ?', ['G3', 'avis G3'])).toEqual([])
  })

  it('conserve une entité réellement prononcée', () => {
    expect(sanitizeEntities('et les toilettes là on en est où ?', ['toilettes'])).toEqual(['toilettes'])
  })

  it('tolère la casse et les accents', () => {
    expect(sanitizeEntities("l'électricité du R+2 est-elle finie ?", ['Électricité'])).toEqual(['Électricité'])
  })

  it('rejette les mots trop génériques', () => {
    expect(sanitizeEntities('où en est le chantier ?', ['chantier'])).toEqual([])
    expect(sanitizeEntities("y avait pas un truc prévu lundi ?", ['truc'])).toEqual([])
  })

  it('plafonne à 3 entités', () => {
    const q = 'toilettes electricite cadenas peinture carrelage'
    expect(sanitizeEntities(q, ['toilettes', 'electricite', 'cadenas', 'peinture'])).toHaveLength(3)
  })
})

describe('parseComprehension — durcissement de la sortie', () => {
  it('rejette une étiquette inconnue', () => {
    expect(parseComprehension('test question', { label: 'READ_EVERYTHING', intent: 'other', entities: [], time_scope: 'none', confidence: 'high' })).toBeNull()
  })

  it('rejette une structure incomplète', () => {
    expect(parseComprehension('test question', { label: 'READ_SITE_STATUS' })).toBeNull()
  })

  it('rejette une valeur non objet', () => {
    expect(parseComprehension('test question', 'READ_SITE_STATUS')).toBeNull()
  })

  it('dégrade READ_SUBJECT sans entité exploitable en READ_SITE_STATUS', () => {
    const c = parseComprehension('où en est le chantier ?', {
      label: 'READ_SUBJECT', intent: 'subject_status', entities: ['chantier'], time_scope: 'none', confidence: 'high',
    })
    expect(c?.label).toBe('READ_SITE_STATUS')
    expect(c?.entities).toEqual([])
  })

  it('dérive le mode depuis l’étiquette, jamais depuis le LLM', () => {
    const c = parseComprehension('ajoute les toilettes', {
      label: 'POSSIBLE_WRITE', intent: 'add_visit_item', entities: ['toilettes'], time_scope: 'next_visit', confidence: 'high',
    })
    expect(c?.mode).toBe('possible_write')
  })
})

// ── 2. Robustesse : le Copilote doit fonctionner sans LLM ─────────────────────

describe('understandQuestion — repli silencieux', () => {
  it('LLM indisponible (exception) → null', async () => {
    const p = provider(async () => { throw new Error('provider down') })
    expect(await understandQuestion('où en est le chantier ?', { provider: p })).toBeNull()
  })

  it('JSON invalide → null', async () => {
    const p = provider(async () => output(undefined, 'je pense que le chantier va bien'))
    expect(await understandQuestion('où en est le chantier ?', { provider: p })).toBeNull()
  })

  it('structure hors contrat → null', async () => {
    const p = provider(async () => output({ intention: 'lecture' }))
    expect(await understandQuestion('où en est le chantier ?', { provider: p })).toBeNull()
  })

  it('LLM trop lent → null (timeout, pas d’attente)', async () => {
    const p = provider(() => new Promise<CompletionOutput>(() => { /* ne résout jamais */ }))
    expect(await understandQuestion('où en est le chantier ?', { provider: p, timeoutMs: 30 })).toBeNull()
  })

  it('récupère le JSON depuis le texte brut quand parsed est absent', async () => {
    const raw = '```json\n{"label":"READ_NEXT_VISIT","intent":"prepare_next_visit","entities":[],"time_scope":"next_visit","confidence":"high"}\n```'
    const p = provider(async () => output(undefined, raw))
    const c = await understandQuestion('je dois contrôler quoi demain ?', { provider: p })
    expect(c?.label).toBe('READ_NEXT_VISIT')
    expect(c?.timeScope).toBe('next_visit')
  })

  it('un échec de compréhension laisse le pipeline déterministe intact', () => {
    const merged = route('quelles actions sont en retard ?', null)
    expect(merged.applied).toEqual([])
    expect(merged.intentResult.intent).toBe('READ')
    expect(merged.classification.primary).toBe('action_status')
  })
})

// ── 3. Le LLM ne déclenche jamais d'écriture ──────────────────────────────────

describe('mergeComprehension — barrière de mutation', () => {
  it('POSSIBLE_WRITE sur une question de lecture ne produit AUCUNE écriture', () => {
    const q = 'Que dois-je vérifier lors de ma prochaine visite ?'
    expect(detectIntent(q).intent).toBe('READ')
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'add_visit_item', entities: ['prochaine visite'] }))
    expect(merged.intentResult.intent).toBe('READ')
    expect(merged.applied).toContain('possible_write_ignored')
  })

  it('POSSIBLE_WRITE précise une écriture non résolue en BROUILLON (jamais en écriture)', () => {
    const q = 'faudrait peut-être vérifier les toilettes'
    expect(detectIntent(q).intent).toBe('UNKNOWN_WRITE')
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'add_visit_item', entities: ['toilettes'] }))
    // ADD_VISIT_ITEM passe par buildCopilotProposal → carte de proposition à valider.
    expect(merged.intentResult.intent).toBe('ADD_VISIT_ITEM')
    expect(merged.intentResult.confidence).toBe('ambiguous')
    expect(merged.applied).toContain('possible_write_refined')
  })

  it('une compréhension "lecture" rétrograde une écriture faiblement déduite', () => {
    const q = "est-ce qu'il faut vérifier les toilettes ?"
    expect(detectIntent(q).intent).toBe('UNKNOWN_WRITE') // limite déterministe connue
    const merged = route(q, comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['toilettes'] }))
    expect(merged.intentResult.intent).toBe('READ')
    expect(merged.applied).toContain('read_downgrade')
  })

  it('ne rétrograde JAMAIS un ordre d’écriture explicite et franc', () => {
    const q = "Ajoute l'accès sécurisé aux points à vérifier à la prochaine visite."
    const det = detectIntent(q)
    expect(det.intent).toBe('ADD_VISIT_ITEM')
    expect(det.confidence).toBe('strong')
    // Même si le LLM se trompe et croit lire une question :
    const merged = route(q, comprehension('READ_NEXT_VISIT', { confidence: 'high' }))
    expect(merged.intentResult.intent).toBe('ADD_VISIT_ITEM')
  })

  it('une compréhension peu sûre ne modifie pas le routage d’écriture', () => {
    const q = 'ajoute les toilettes à vérifier demain'
    const merged = route(q, comprehension('READ_SITE_STATUS', { confidence: 'low' }))
    expect(merged.intentResult.intent).toBe(detectIntent(q).intent)
    expect(merged.applied).not.toContain('read_downgrade')
  })
})

// ── 4. Erreur de chargement ≠ zéro résultat ───────────────────────────────────

describe('resolveQuantitativeVerdict — ne jamais affirmer "aucune" à tort', () => {
  it('périmètre chargé et vide → zéro confirmé, réponse ferme', () => {
    const v = resolveQuantitativeVerdict({ primaryIntent: 'action_status', itemCount: 0, overviewLoadFailed: false })
    expect(v?.kind).toBe('confirmed_zero')
    expect(v?.text).toContain('Aucune action')
  })

  it('chargement en échec → jamais "aucune", réponse honnête', () => {
    const v = resolveQuantitativeVerdict({ primaryIntent: 'action_status', itemCount: 0, overviewLoadFailed: true })
    expect(v?.kind).toBe('unknown')
    expect(v?.text).not.toMatch(/^Aucune action n'est actuellement/)
    expect(v?.text).toContain("pas pu charger")
  })

  it('des résultats existent → pas de court-circuit, le LLM répond', () => {
    expect(resolveQuantitativeVerdict({ primaryIntent: 'action_status', itemCount: 3, overviewLoadFailed: false })).toBeNull()
  })

  it('ne court-circuite que les questions quantitatives sur les actions', () => {
    expect(resolveQuantitativeVerdict({ primaryIntent: 'global', itemCount: 0, overviewLoadFailed: false })).toBeNull()
    expect(resolveQuantitativeVerdict({ primaryIntent: 'timeline', itemCount: 0, overviewLoadFailed: true })).toBeNull()
  })
})

// ── 5. Corpus de parole naturelle ─────────────────────────────────────────────
//
// `llm` décrit la compréhension ATTENDUE du prompt pour cette phrase.
// `family` : famille de lecture visée après fusion.
// `deterministicWrite` : true = sans LLM, le déterministe part encore sur un
// brouillon (limite documentée — un brouillon exige toujours une validation).

type Case = {
  q: string
  llm: Comprehension
  family?: string
  deterministicWrite?: boolean
}

const READ_CORPUS: Case[] = [
  // — Les 7 cas de recette mandatés —
  { q: 'Où en est le chantier ?', llm: comprehension('READ_SITE_STATUS', { intent: 'site_status' }), family: 'global' },
  { q: "Qu'est-ce qui a changé depuis la dernière visite ?", llm: comprehension('READ_RECENT_CHANGES', { intent: 'recent_changes', timeScope: 'since_last_visit' }), family: 'timeline' },
  { q: "Qu'est-ce qui traîne ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'action_status' },
  { q: 'Quelles actions sont en retard ?', llm: comprehension('READ_ACTION_STATUS', { intent: 'action_status' }), family: 'action_status' },
  { q: 'Que dois-je vérifier lors de ma prochaine visite ?', llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', timeScope: 'next_visit' }), family: 'plan_visite' },
  { q: "euh demain quand j'y retourne qu'est-ce qu'il faut que je regarde déjà ?", llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', timeScope: 'next_visit' }), family: 'plan_visite' },

  // — Formulations orales (retour Vincent) —
  { q: "euh demain quand j'y retourne qu'est-ce que je regarde ?", llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', timeScope: 'next_visit' }), family: 'plan_visite' },
  { q: 'tu me fais le point sur le chantier ?', llm: comprehension('READ_SITE_STATUS', { intent: 'site_status' }), family: 'global', deterministicWrite: true },
  { q: 'et les toilettes là on en est où ?', llm: comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['toilettes'] }), family: 'subject_detail' },
  { q: 'le cadenas ça a changé depuis la dernière fois ?', llm: comprehension('READ_SUBJECT', { intent: 'subject_evolution', entities: ['cadenas'], timeScope: 'since_last_visit' }), family: 'subject_detail' },
  { q: "y avait pas un truc prévu lundi ?", llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', confidence: 'medium' }) },
  { q: 'je dois contrôler quoi demain ?', llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', timeScope: 'next_visit' }), family: 'plan_visite' },
  { q: "qu'est-ce qui n'a pas bougé ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'action_status' },
  { q: "qu'est-ce qui traîne encore ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'action_status' },
  { q: "est-ce qu'on a des actions vraiment en retard ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'action_status' }), family: 'action_status' },
  { q: "est-ce qu'il faut vérifier les toilettes ?", llm: comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['toilettes'] }), family: 'subject_detail', deterministicWrite: true },

  // — Formulations supplémentaires (dérive orale anticipée) —
  { q: "rappelle-moi ce qu'on devait contrôler", llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit' }), family: 'plan_visite', deterministicWrite: true },
  { q: 'tu peux me dire ce que je regarde demain ?', llm: comprehension('READ_NEXT_VISIT', { intent: 'prepare_next_visit', timeScope: 'next_visit' }), family: 'plan_visite' },
  { q: 'on en est où sur le cadenas ?', llm: comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['cadenas'] }), family: 'subject_detail' },
  { q: "il s'est passé quoi récemment ?", llm: comprehension('READ_RECENT_CHANGES', { intent: 'recent_changes', timeScope: 'recent' }), family: 'timeline' },
  { q: 'bon alors le carrelage ça avance ou pas ?', llm: comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['carrelage'] }), family: 'subject_detail' },
  { q: "y a quoi de bloqué en ce moment ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'action_status' }), family: 'action_status' },
]

const WRITE_CORPUS: Case[] = [
  { q: "Ajoute l'accès sécurisé aux points à vérifier à la prochaine visite.", llm: comprehension('POSSIBLE_WRITE', { intent: 'add_visit_item' }) },
  { q: 'ajoute les toilettes à vérifier demain', llm: comprehension('POSSIBLE_WRITE', { intent: 'add_visit_item', entities: ['toilettes'] }) },
  { q: 'planifie une visite lundi', llm: comprehension('POSSIBLE_WRITE', { intent: 'schedule_visit' }) },
  { q: "note qu'il faut contrôler R4", llm: comprehension('POSSIBLE_WRITE', { intent: 'create_action', entities: ['R4'] }) },
]

describe('corpus de parole naturelle — 26 formulations', () => {
  it('couvre au moins 20 formulations', () => {
    expect(READ_CORPUS.length + WRITE_CORPUS.length).toBeGreaterThanOrEqual(20)
  })

  describe('avec compréhension : une question reste une lecture', () => {
    for (const c of READ_CORPUS) {
      it(`« ${c.q} » → lecture${c.family ? ` (${c.family})` : ''}`, () => {
        const merged = route(c.q, c.llm)
        expect(merged.intentResult.intent).toBe('READ')
        if (c.family) expect(merged.classification.primary).toBe(c.family)
      })
    }
  })

  describe('sans LLM : le déterministe reste cohérent', () => {
    for (const c of READ_CORPUS) {
      it(`« ${c.q} »`, () => {
        const merged = route(c.q, null)
        if (c.deterministicWrite) {
          // Limite déterministe connue : un brouillon est proposé, jamais écrit.
          // La compréhension LLM corrige ce cas (test ci-dessus).
          expect(merged.intentResult.intent).not.toBe('READ')
          expect(merged.intentResult.confidence).toBe('ambiguous')
        } else {
          expect(merged.intentResult.intent).toBe('READ')
        }
      })
    }
  })

  describe('ordres explicites : brouillon soumis à validation', () => {
    for (const c of WRITE_CORPUS) {
      it(`« ${c.q} » → brouillon`, () => {
        expect(route(c.q, c.llm).intentResult.intent).not.toBe('READ')
        // Et sans LLM, l'ordre reste reconnu.
        expect(route(c.q, null).intentResult.intent).not.toBe('READ')
      })
    }
  })

  it("aucune formulation du corpus n'introduit un sujet absent de la question", () => {
    for (const c of [...READ_CORPUS, ...WRITE_CORPUS]) {
      const merged = route(c.q, c.llm)
      if (!merged.subjectHintsFromLlm) continue
      const nq = c.q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      for (const label of merged.classification.entities.subjectLabels) {
        expect(nq).toContain(label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
      }
    }
  })
})
