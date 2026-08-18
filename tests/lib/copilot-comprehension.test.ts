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
import { classifyIntent, classifyReadIntent } from '@/lib/visits/copilot-classify'
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

// ── 3bis. OBSERVATION — recette terrain P4-A (Vincent, 2026-08-17) ────────────
//
// COMPREHENSION_LABELS n'a aucun concept d'observation factuelle : le LLM
// classe systématiquement un constat déclaratif ("le cadenas n'est toujours
// pas installé") en 'read' faute de mieux. Sans exemption, read_downgrade
// annulait la capture pour 2 des 3 formulations positives de la recette.
// Le garde READ du routeur déterministe s'exécute AVANT la branche OBSERVATION
// (Priorité 4bis) : une vraie question ne peut donc jamais atteindre
// OBSERVATION, ce qui rend l'exemption sûre.
describe('mergeComprehension — OBSERVATION n’est jamais rétrogradée par le LLM', () => {
  it('un constat factuel classé "read" par le LLM reste OBSERVATION', () => {
    const q = "Le cadenas n'est toujours pas installé."
    expect(detectIntent(q).intent).toBe('OBSERVATION')
    const merged = route(q, comprehension('READ_ACTION_STATUS', { intent: 'action_status', entities: ['cadenas'] }))
    expect(merged.intentResult.intent).toBe('OBSERVATION')
    expect(merged.applied).not.toContain('read_downgrade')
  })

  it('un constat avec acteur classé "read" par le LLM reste OBSERVATION', () => {
    const q = "Clim Expair n'est pas venu aujourd'hui."
    expect(detectIntent(q).intent).toBe('OBSERVATION')
    const merged = route(q, comprehension('READ_ACTION_STATUS', { intent: 'action_status', entities: ['Clim Expair'] }))
    expect(merged.intentResult.intent).toBe('OBSERVATION')
    expect(merged.applied).not.toContain('read_downgrade')
  })

  it('les indices de sujet du LLM alimentent subjectLabels pour OBSERVATION (canonical_subject_id est NOT NULL en base)', () => {
    const q = 'Le portail est maintenant réparé.'
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'subject_evolution', entities: ['portail'] }))
    expect(merged.intentResult.intent).toBe('OBSERVATION')
    expect(merged.classification.entities.subjectLabels).toEqual(['portail'])
    expect(merged.applied).toContain('subject_hints')
  })

  it('un code technique tapé par l’utilisateur n’est jamais écrasé par un indice LLM', () => {
    const q = 'G3 est toujours pas terminé.'
    const merged = route(q, comprehension('READ_SUBJECT', { intent: 'subject_status', entities: ['autre sujet'] }))
    expect(merged.intentResult.intent).toBe('OBSERVATION')
    expect(merged.classification.entities.subjectLabels).toEqual(['G3'])
  })

  it('reste OBSERVATION même sans compréhension LLM (repli déterministe)', () => {
    const q = "Le cadenas n'est toujours pas installé."
    const merged = route(q, null)
    expect(merged.intentResult.intent).toBe('OBSERVATION')
  })
})

// ── 3ter. NEGATION_SCOPE doit survivre à la fusion LLM (régression terrain
// OCEF, 2026-08-18) ────────────────────────────────────────────────────────
//
// « Ne planifie pas de réunion vendredi. » : le routeur déterministe neutralise
// bien la négation (hasNegatedWrite bloque la branche SCHEDULE_MEETING,
// signals contient 'negated_write_verb') et retombe sur UNKNOWN_WRITE — mais
// la couche de compréhension LLM (SYSTEM_PROMPT sans AUCUNE notion de
// négation) classe la phrase POSSIBLE_WRITE/schedule_meeting sur la seule
// présence de "planifie…réunion…vendredi". La section 2 de mergeComprehension
// ("précision d'une écriture non résolue") traite alors UNKNOWN_WRITE comme
// un cas ouvert à la précision du LLM, sans jamais consulter les signals du
// routeur : elle réintroduit exactement l'intention que NEGATION_SCOPE avait
// neutralisée. Repro exacte des deux transcripts terrain (Vincent).
describe('mergeComprehension — NEGATION_SCOPE ne doit jamais être écrasée par la précision LLM', () => {
  it('"Ne planifie pas de réunion vendredi." → jamais SCHEDULE_MEETING, même si le LLM y voit un ordre', () => {
    const q = 'Ne planifie pas de réunion vendredi.'
    const det = detectIntent(q)
    expect(det.intent).toBe('UNKNOWN_WRITE')
    expect(det.signals).toContain('negated_write_verb')
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'schedule_meeting' }))
    expect(merged.intentResult.intent).not.toBe('SCHEDULE_MEETING')
  })

  it('STT dégradé "Ne ne planifie pas de réunion vendredi." → même garde', () => {
    const q = 'Ne ne planifie pas de réunion vendredi.'
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'schedule_meeting' }))
    expect(merged.intentResult.intent).not.toBe('SCHEDULE_MEETING')
  })

  // Extension bornée jamais/rien/plus (bloqueur n°2, audit causal P6-A2
  // 2026-08-18) : la garde ci-dessus ne teste que "pas". Elle doit protéger
  // identiquement les nouveaux patrons de négation structurée, car elle est
  // générique (clé sur la présence du signal 'negated_write_verb', jamais sur
  // le mot qui l'a déclenché) — à vérifier, pas à réécrire.
  it('"Ne planifie jamais de réunion vendredi." → jamais SCHEDULE_MEETING, même si le LLM y voit un ordre', () => {
    const q = 'Ne planifie jamais de réunion vendredi.'
    const det = detectIntent(q)
    expect(det.intent).not.toBe('SCHEDULE_MEETING')
    expect(det.signals).toContain('negated_write_verb')
    const merged = route(q, comprehension('POSSIBLE_WRITE', { intent: 'schedule_meeting' }))
    expect(merged.intentResult.intent).not.toBe('SCHEDULE_MEETING')
  })
})

// ── 4. Erreur de chargement ≠ zéro résultat ───────────────────────────────────

describe('resolveQuantitativeVerdict — ne jamais affirmer "aucune" à tort', () => {
  const RETARD = 'quelles actions sont en retard ?'

  it('compteur métier chargé à zéro → zéro confirmé, réponse ferme', () => {
    const v = resolveQuantitativeVerdict({
      question: RETARD, primaryIntent: 'action_status',
      measures: { actionsOverdue: 0 }, overviewLoadFailed: false,
    })
    expect(v?.kind).toBe('confirmed_zero')
    expect(v?.text).toContain('Aucune action')
  })

  it('chargement en échec → jamais "aucune", réponse honnête', () => {
    const v = resolveQuantitativeVerdict({
      question: RETARD, primaryIntent: 'action_status',
      measures: { actionsOverdue: 0 }, overviewLoadFailed: true,
    })
    expect(v?.kind).toBe('unknown')
    expect(v?.text).not.toMatch(/^Aucune action n'est actuellement/)
    expect(v?.text).toContain('pas pu charger')
  })

  // LE défaut PETRO ATTITI : le contexte filtré était vide, et cette absence
  // était lue comme un zéro métier. Une mesure absente ne vaut plus zéro.
  it('compteur NON chargé → "je ne sais pas", jamais un zéro', () => {
    const v = resolveQuantitativeVerdict({
      question: RETARD, primaryIntent: 'action_status',
      measures: {}, overviewLoadFailed: false,
    })
    expect(v?.kind).toBe('unknown')
    expect(v?.text).not.toMatch(/Aucune action/)
  })

  it('des résultats existent → pas de court-circuit, le LLM répond', () => {
    expect(resolveQuantitativeVerdict({
      question: RETARD, primaryIntent: 'action_status',
      measures: { actionsOverdue: 3 }, overviewLoadFailed: false,
    })).toBeNull()
  })

  it('ne court-circuite jamais une question de synthèse', () => {
    expect(resolveQuantitativeVerdict({
      question: 'où en est le chantier ?', primaryIntent: 'global',
      measures: { actionsOverdue: 0 }, overviewLoadFailed: false,
    })).toBeNull()
    expect(resolveQuantitativeVerdict({
      question: "qu'est-ce qui a changé ?", primaryIntent: 'timeline',
      measures: { actionsOverdue: 0 }, overviewLoadFailed: true,
    })).toBeNull()
  })

  // « Qu'est-ce qui bloque ? » ne doit JAMAIS recevoir le compteur d'actions en
  // retard : blocage déclaré et date dépassée sont deux faits différents.
  it('une question sur les blocages ne reçoit pas le zéro des actions', () => {
    const v = resolveQuantitativeVerdict({
      question: "qu'est-ce qui bloque sur le chantier ?", primaryIntent: 'action_status',
      measures: { actionsOverdue: 0, blocagesActive: 2 }, overviewLoadFailed: false,
    })
    expect(v).toBeNull()
  })

  it('stagnation à zéro → le sujet le plus proche du seuil est nommé', () => {
    const v = resolveQuantitativeVerdict({
      question: "qu'est-ce qui n'avance pas ?", primaryIntent: 'stagnation',
      measures: { subjectsStagnant: 0 }, overviewLoadFailed: false,
      stagnationClosest: { title: 'Couche de forme', days: 24 },
    })
    expect(v?.kind).toBe('confirmed_zero')
    expect(v?.text).toContain('seuil de stagnation')
    expect(v?.text).toContain('Couche de forme')
    expect(v?.text).toContain('24 jours')
  })

  it('stagnation avérée → pas de court-circuit, le LLM détaille', () => {
    expect(resolveQuantitativeVerdict({
      question: "qu'est-ce qui stagne ?", primaryIntent: 'stagnation',
      measures: { subjectsStagnant: 2 }, overviewLoadFailed: false,
    })).toBeNull()
  })
})

// ── 4bis. Stagnation ≠ retard d'action ────────────────────────────────────────

describe('famille stagnation', () => {
  it('« qu\'est-ce qui n\'avance pas ? » est une stagnation, pas un retard', () => {
    expect(classifyReadIntent("qu'est-ce qui n'avance pas ?").primary).toBe('stagnation')
    expect(classifyReadIntent('quels sujets stagnent ?').primary).toBe('stagnation')
    expect(classifyReadIntent("qu'est-ce qui traîne depuis un moment ?").primary).toBe('stagnation')
    expect(classifyReadIntent("qu'est-ce qui n'a pas bougé ?").primary).toBe('stagnation')
  })

  it('« quelles actions sont en retard ? » reste une question d\'actions', () => {
    expect(classifyReadIntent('quelles actions sont en retard ?').primary).toBe('action_status')
  })

  it('« qu\'est-ce qui bloque ? » reste sur la famille actions/blocages', () => {
    expect(classifyReadIntent("qu'est-ce qui bloque ?").primary).toBe('action_status')
  })

  it('l\'intention LLM stale_subjects redirige vers stagnation', () => {
    const merged = route('où ça coince en ce moment ?', comprehension('READ_ACTION_STATUS', {
      intent: 'stale_subjects', confidence: 'high',
    }))
    expect(merged.classification.primary).toBe('stagnation')
  })

  it('le LLM ne rétrograde pas une stagnation détectée déterministiquement', () => {
    const merged = route("qu'est-ce qui n'avance pas ?", comprehension('READ_ACTION_STATUS', {
      intent: 'action_status', confidence: 'high',
    }))
    expect(merged.classification.primary).toBe('stagnation')
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
  // Les trois formulations ci-dessous portent `intent: 'stale_subjects'` : elles
  // attendaient `action_status` tant que la stagnation n'était pas une famille à
  // part entière. Elles attendent désormais `stagnation` — c'est le correctif du
  // défaut PETRO ATTITI (« qu'est-ce qui n'avance pas ? » → « aucune action en
  // retard »), pas une régression. Le routeur d'ÉCRITURE, lui, est inchangé :
  // `intentResult.intent` reste 'READ' sur les 26 formulations.
  { q: "Qu'est-ce qui traîne ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'stagnation' },
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
  { q: "qu'est-ce qui n'a pas bougé ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'stagnation' },
  { q: "qu'est-ce qui traîne encore ?", llm: comprehension('READ_ACTION_STATUS', { intent: 'stale_subjects' }), family: 'stagnation' },
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
