// services/ai/visit-debrief.ts
// Débrief de CHANTIER (desktop), déclenché ici par une VISITE. Le débrief n'est
// pas « celui de la visite » : il analyse ce qui vient de modifier la mémoire du
// site sur une fenêtre temporelle. La visite est le 1er type de déclencheur ;
// réunion / mail / DOE / intervention deviendront d'autres déclencheurs SANS
// changer le paradigme (moteur de contexte multi-événements gelé — cf.
// moteur-de-contexte-chantier).
//
// MOTEUR EN DEUX AGENTS (raisonnement → structure, cf. roadmap-ia-debrief) :
//   Agent 1 — COMPRÉHENSION : le LLM joue le conducteur qui rentre et débriefe son
//     directeur en 2 min. Texte libre. C'est l'agent qu'on fera évoluer.
//   Agent 2 — EXTRACTION : à partir du SEUL débrief de l'agent 1, extrait la
//     structure (objectif/sujet/résultat/confiance/actions/questions…). Stable,
//     léger (modelTier 'light'). Garantit le contrat de données.
//
// L'IA PROPOSE et N'ÉCRIT RIEN : persistance uniquement après validation humaine.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'

const OUTCOMES = ['ras', 'conforme', 'conforme_reserves', 'non_conforme', 'a_revoir', 'info'] as const
const RESOLUTIONS = ['resolue', 'a_suivre', 'recontrole'] as const
const CONFIDENCE = ['elevee', 'moyenne', 'faible'] as const
const PRIORITY = ['haute', 'moyenne', 'basse'] as const

// Le LLM structure de façon variable (parfois une chaîne au lieu d'un objet, une
// priorité en anglais…). On TOLÈRE : on normalise avant de valider, plutôt que de
// rejeter toute l'extraction pour une virgule de forme.
function toPriority(v: unknown): 'haute' | 'moyenne' | 'basse' | null {
  const s = String(v ?? '').toLowerCase()
  if (/haut|urgent|high|élev|elev/.test(s)) return 'haute'
  if (/moy|medium|normal/.test(s)) return 'moyenne'
  if (/bas|prépar|prepar|low|faible/.test(s)) return 'basse'
  return null
}

// Le LLM écrit souvent `null` pour un champ vide → on le tolère (null|undefined → '').
const optStr = z.preprocess((v) => (v == null ? '' : v), z.string())

export const visitDebriefSchema = z.object({
  // Niveau 1 — « ce qui mérite ton attention » : 3 à 5 max. C'est un FILTRE.
  attention: z.array(z.string()).max(8).default([]),
  objective: z.string().default(''),
  objective_rationale: z.string().default(''), // POURQUOI : reformule ce que dit le débrief
  objective_confidence: z.enum(CONFIDENCE).nullable().default(null),
  subject_match_index: z.number().int().default(-1), // index dans openSubjects, -1 = nouveau/aucun
  subject_name: z.string().default(''),
  subject_rationale: z.string().default(''),
  subject_confidence: z.enum(CONFIDENCE).nullable().default(null),
  outcome: z.enum(OUTCOMES).nullable().default(null),
  resolution: z.enum(RESOLUTIONS).nullable().default(null),
  // ⚠️ Points de vigilance — de vrais RISQUES, exploitables : impact + responsable
  // + échéance quand le débrief les donne (sinon vides). TOLÉRANT : chaîne → objet.
  important_points: z.array(z.preprocess(
    (v) => (typeof v === 'string' ? { label: v } : v),
    z.object({
      label: z.string(),
      impact: optStr,
      owner: optStr,
      due: optStr,
    }),
  )).default([]),
  // ✅ Actions — des CARTES : quoi + pourquoi + priorité + responsable + échéance.
  // TOLÉRANT : chaîne → objet ; priorité en anglais/variante → normalisée ; null → ''.
  suggested_actions: z.array(z.preprocess(
    (v) => (typeof v === 'string' ? { title: v } : v),
    z.object({
      title: z.string(),
      rationale: optStr,
      priority: z.preprocess((p) => toPriority(p), z.enum(PRIORITY).nullable()).default(null),
      owner: optStr,
      due: optStr,
    }),
  )).default([]),
  // ✓ Décisions PRISES — les engagements actés pendant la visite (ni action à
  // faire, ni risque : ce qui a été tranché). « Les accès seront fournis plus tard. »
  decisions: z.array(z.string()).default([]),
  // ℹ️ À savoir — le CONTEXTE important mais NON actionnable (ni action, ni risque,
  // ni décision). « Première visite. », « Le nettoyage précède l'intervention. »
  a_savoir: z.array(z.string()).default([]),
  forgotten_obligations: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
})
export type VisitDebriefParsed = z.infer<typeof visitDebriefSchema>

// ── Agent 1 — Compréhension (narratif, joue le conducteur) ────────────────────

const UNDERSTANDING_SYSTEM = `Tu es le CONDUCTEUR DE TRAVAUX qui rentre du chantier. Tu disposes de ce que tu
as capturé pendant ta visite (vocal, notes, photos, réserves, actions) et du
contexte mémoire du site (sujets connus, signaux : réserves ouvertes, retards,
obligations).

Tu disposes AUSSI d'une SYNTHÈSE du chantier (réunions/visites récentes, actions et
réserves ouvertes en chiffres, décisions, obligations) et de la liste des SUJETS
ouverts avec leur ancienneté et leur activité. IDENTIFIE toi-même le sujet que
cette visite concerne PAR LE SENS, même si son nom exact n'est pas prononcé (ex.
« la porte coupe-feu du bloc C n'est pas posée » → sujet « Sécurité incendie ») ;
ou conclus « aucun » / « nouveau sujet ». Ton débrief ne doit donc PAS seulement
dire « ce que j'ai compris de la visite », mais « ce que cette visite CHANGE dans
l'histoire du chantier ». Demande-toi explicitement :
- Cette visite CONFIRME-t-elle quelque chose de déjà connu (une tendance, une crainte) ?
- Est-ce un NOUVEAU sujet, ou un sujet qui TRAÎNE (repoussé plusieurs fois) ?
- Qu'est-ce qui a CHANGÉ depuis la dernière fois ?

Fais le DÉBRIEF que tu présenterais à ton directeur en 2 minutes, à voix haute,
en français : pourquoi tu es allé là-bas, ce que tu as constaté, ce que ça change
dans l'histoire du chantier, ce qui reste ouvert, ce qui t'inquiète, et ce qu'il
faut faire ensuite. Commence par ce qui MÉRITE l'attention en priorité.

Règles :
- Appuie-toi UNIQUEMENT sur les éléments fournis — n'invente aucun fait précis
  (chiffre, date, nom) absent. Tu peux relier la visite à l'historique fourni.
- Quand un indice est mince, dis-le franchement (« je ne suis pas sûr, une seule
  mention »). La franchise vaut mieux que l'assurance.
- Sois concret et sobre, pas de remplissage.
- JAMAIS de jugement sur une personne : tu parles de l'ouvrage, des sujets, des
  obligations, jamais de la valeur des gens.`

// ── Agent 2 — Extraction (structure stable à partir du débrief) ───────────────

const EXTRACTION_SYSTEM = `Tu es un EXTRACTEUR. On te donne le DÉBRIEF rédigé par le conducteur de travaux,
et la liste des sujets connus du site (par index). Tu produis UNIQUEMENT la
structure JSON demandée, FIDÈLE au débrief : n'ajoute AUCUN fait que le débrief ne
contient pas. Si le débrief ne dit rien sur un champ, laisse-le vide / null.

Les « rationale » et le « pourquoi » REFORMULENT ce que dit le débrief (pas
d'invention). La confiance (elevee | moyenne | faible) reflète la FERMETÉ du
débrief sur ce point (le conducteur hésite → faible). « attention » = 3 à 5 MAX,
les éléments les plus décisifs du débrief — c'est un FILTRE, pas un résumé complet.

Champs :
- attention : 3 à 5 max, les éléments les plus décisifs.
- objective : l'objectif de la visite tel que le conducteur l'exprime. Vide si absent.
- objective_rationale : pourquoi (reformule). objective_confidence : elevee|moyenne|faible|null.
- subject_match_index : index du sujet connu correspondant (liste fournie), sinon -1.
- subject_name : le sujet principal (nom existant retenu, ou nouveau nom court si -1).
- subject_rationale : pourquoi ce sujet. subject_confidence : elevee|moyenne|faible|null.
- outcome : ras|conforme|conforme_reserves|non_conforme|a_revoir|info, ou null. JAMAIS un jugement sur une personne.
- resolution : resolue|a_suivre|recontrole, ou null.
- important_points : les RISQUES / points de vigilance, EXPLOITABLES. [{ label (le risque, court), impact (conséquence si non traité), owner (qui doit agir, si le débrief le dit), due (échéance, si dite) }]. Laisse impact/owner/due VIDES si le débrief ne les donne pas — n'invente pas.
- suggested_actions : les actions à FAIRE. [{ title (impératif court), rationale (pourquoi), priority ("haute"|"moyenne"|"basse" selon l'urgence exprimée, sinon null), owner (qui, si dit), due (échéance, si dite) }].
- decisions : les DÉCISIONS PRISES / engagements actés pendant la visite — ce qui a été TRANCHÉ, ni action à faire ni risque. Ex. « Les accès seront fournis ultérieurement. », « Une nouvelle visite sera organisée. »
- a_savoir : le CONTEXTE important mais NON actionnable (ni action, ni risque, ni décision). Ex. « Première visite du chantier. », « Le nettoyage précède l'intervention. », « Les travaux n'ont pas commencé. »
- forgotten_obligations : obligations/contrôles que le débrief signale comme oubliés ou manquants.
- open_questions : questions ouvertes soulevées par le débrief (aide à la réflexion, ni action ni résumé).`

export interface VisitDebriefInput {
  objectiveHint: string | null
  capturedText: string | null
  transcript: string | null
  attachmentNames: string[]
  capturedNotes: string[]
  capturedActions: Array<{ title: string; corps_etat: string | null }>
  capturedReserves: Array<{ label: string; location: string | null }>
  signalLines: string[]
  openSubjects: Array<{ id: string; name: string }>
  // V2.1 — contexte métier condensé du chantier (bornée au site, jamais cross-chantier).
  siteHistory: string
  /** Digest court par sujet ouvert — l'Agent 1 identifie LUI-MÊME le concerné. */
  subjectDigests: string[]
  userId: string | null
}

export interface VisitDebriefResult {
  narrative: string          // Agent 1 — « voilà ce que j'ai compris » (montré à l'UI)
  parsed: VisitDebriefParsed // Agent 2 — structure extraite
  model: string | null
  provider: AIProviderName
}

/** Bloc de contexte fourni à l'Agent 1. */
function buildContextBlock(input: VisitDebriefInput): string {
  return [
    '=== Vocal / transcription ===',
    input.transcript?.slice(0, 10000) || '(aucun)',
    '',
    '=== Notes saisies ===',
    input.capturedNotes.length > 0 ? input.capturedNotes.join('\n') : (input.capturedText ?? '(aucune)'),
    '',
    '=== Photos / pièces (noms uniquement) ===',
    input.attachmentNames.length > 0 ? input.attachmentNames.join('\n') : '(aucune)',
    '',
    '=== Actions créées pendant la visite ===',
    input.capturedActions.length > 0 ? input.capturedActions.map((a) => `- ${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`).join('\n') : '(aucune)',
    '',
    '=== Réserves créées pendant la visite ===',
    input.capturedReserves.length > 0 ? input.capturedReserves.map((r) => `- ${r.label}${r.location ? ` @ ${r.location}` : ''}`).join('\n') : '(aucune)',
    '',
    '=== Contexte mémoire du site (signaux déterministes) ===',
    input.signalLines.length > 0 ? input.signalLines.join('\n') : '(aucun signal)',
    '',
    '=== Contexte métier du chantier (synthèse) ===',
    input.siteHistory || '(aucun historique)',
    '',
    '=== Sujets ouverts du chantier (avec leur ancienneté/activité) ===',
    input.subjectDigests.length > 0
      ? input.subjectDigests.map((d) => `- ${d}`).join('\n') + '\nIDENTIFIE lequel cette visite concerne (par son sens, pas par les mots exacts), ou « aucun / nouveau sujet ».'
      : '(aucun sujet ouvert)',
    input.objectiveHint ? `\n=== Objectif déjà renseigné ===\n${input.objectiveHint}` : '',
  ].join('\n')
}

/** Mock Agent 1 : un récit déterministe à partir du contexte (démo sans clé IA). */
function mockNarrative(input: VisitDebriefInput): string {
  const bits: string[] = []
  bits.push(`Je suis passé sur le chantier${input.objectiveHint ? ` pour ${input.objectiveHint.toLowerCase()}` : ''}.`)
  if (input.capturedNotes[0]) bits.push(`J'ai noté : ${input.capturedNotes[0]}.`)
  if (input.capturedReserves[0]) bits.push(`J'ai relevé une réserve : ${input.capturedReserves[0].label}.`)
  const subj = input.openSubjects[0]?.name ?? null
  if (subj) bits.push(`Ça rejoint le sujet « ${subj} » qu'on suit déjà${input.subjectDigests.length > 1 ? ' — et qui revient régulièrement' : ''}.`)
  if (input.signalLines[0]) bits.push(`Côté contexte, ${input.signalLines[0].toLowerCase()}.`)
  if (input.siteHistory) bits.push(`Par rapport aux derniers passages, rien de spectaculaire n'a changé.`)
  bits.push(`Rien d'autre de bloquant pour l'instant — à recontrôler au prochain passage si une réserve reste ouverte.`)
  return bits.join(' ')
}

/** Mock Agent 2 : extraction déterministe (démo sans clé IA). */
function mockExtraction(input: VisitDebriefInput): VisitDebriefParsed {
  const firstNote = input.capturedNotes[0] ?? input.transcript ?? input.capturedText ?? ''
  const hasReserve = input.capturedReserves.length > 0
  return {
    attention: [...input.signalLines.slice(0, 3), ...(hasReserve ? [`Réserve « ${input.capturedReserves[0].label} » créée`] : [])].slice(0, 5),
    objective: input.objectiveHint ?? (firstNote ? firstNote.slice(0, 80) : ''),
    objective_rationale: firstNote ? 'Déduit de la première note / du vocal capturé.' : 'Aucun indice textuel — objectif indéterminé.',
    objective_confidence: firstNote ? 'moyenne' : 'faible',
    subject_match_index: input.openSubjects.length > 0 ? 0 : -1,
    subject_name: input.openSubjects[0]?.name ?? '',
    subject_rationale: input.openSubjects[0] ? `Rapproché du sujet existant « ${input.openSubjects[0].name} ».` : 'Aucun sujet connu correspondant.',
    subject_confidence: input.openSubjects[0] ? 'moyenne' : 'faible',
    outcome: hasReserve ? 'conforme_reserves' : null,
    resolution: hasReserve ? 'recontrole' : null,
    important_points: input.capturedNotes.slice(0, 3).map((n) => ({ label: n, impact: '', owner: '', due: '' })),
    suggested_actions: hasReserve
      ? [{ title: `Suivre la réserve « ${input.capturedReserves[0].label} »`, rationale: 'Une réserve a été créée pendant la visite.', priority: 'moyenne' as const, owner: '', due: '' }]
      : [],
    decisions: [],
    a_savoir: input.objectiveHint ? [`Objectif de la visite : ${input.objectiveHint}.`] : [],
    forgotten_obligations: input.signalLines.slice(0, 2),
    open_questions: hasReserve ? [`La réserve « ${input.capturedReserves[0].label} » est-elle toujours valide ?`] : [],
  }
}

export async function runVisitDebriefAgent(input: VisitDebriefInput): Promise<VisitDebriefResult> {
  const provider = getAIProvider()

  // ── Agent 1 — Compréhension (narratif) ──
  const narrative = await withAITracking('visit_debrief_understand', input.userId, async () => {
    const userMessage = provider.name === 'mock'
      ? `__MOCK_FIXTURE__:${JSON.stringify(mockNarrative(input))}`
      : `${buildContextBlock(input)}\n\nFais ton débrief (2 minutes max, à voix haute).`
    const out = await provider.complete({
      systemPrompt: UNDERSTANDING_SYSTEM,
      userMessage,
      modelTier: 'heavy',
      maxOutputTokens: 900,
    })
    const text = (out.text ?? '').trim()
    if (!text) throw new Error('[visit-debrief] Agent 1 (compréhension) a rendu un débrief vide')
    return { result: text, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  // ── Agent 2 — Extraction (structure stable, léger) ──
  const parsed = await withAITracking('visit_debrief_extract', input.userId, async () => {
    let userMessage: string
    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockExtraction(input))}`
    } else {
      const subjectsList = input.openSubjects.length > 0
        ? input.openSubjects.map((s, i) => `[${i}] ${s.name}`).join('\n')
        : '(aucun sujet connu)'
      userMessage = [
        '=== Débrief du conducteur (source unique de l’extraction) ===',
        narrative,
        '',
        '=== Sujets connus du site (par index, pour subject_match_index) ===',
        subjectsList,
        '',
        'Extrais la structure JSON, fidèle au débrief ci-dessus.',
      ].join('\n')
    }
    const out = await provider.complete({
      systemPrompt: EXTRACTION_SYSTEM,
      userMessage,
      responseSchema: visitDebriefSchema,
      modelTier: 'light',
      maxOutputTokens: 2500,
    })
    let result: VisitDebriefParsed | undefined
    if (out.parsed !== undefined && out.parsed !== null) {
      const r = visitDebriefSchema.safeParse(out.parsed)
      if (r.success) result = r.data
    }
    if (result === undefined) {
      try {
        const r = visitDebriefSchema.safeParse(JSON.parse(out.text))
        if (r.success) result = r.data
      } catch { /* ignore */ }
    }
    if (result === undefined) throw new Error('[visit-debrief] Agent 2 (extraction) — parsing impossible')
    return { result, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  return { narrative, parsed, model: null, provider: provider.name }
}
