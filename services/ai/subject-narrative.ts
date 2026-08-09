import 'server-only'

// Synthèse narrative d'un canonical_subject — 1 à 2 phrases.
//
// Doctrine :
// - Le LLM articule des faits déjà calculés, il n'invente rien.
// - Input = faits structurés depuis buildCanonicalSubjectIntelligence (pas de texte brut).
// - Silencieux sur erreur ou output invalide — la fiche fonctionne sans cette section.
// - modelTier 'light', maxOutputTokens 150 — input < 300 tokens, output très court.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'
import type { CanonicalSubjectIntelligence } from '@/lib/knowledge/build-canonical-subject-intelligence'

export interface SubjectNarrativeResult {
  narrative: string
  usedFactIds: string[]
  model: string
}

// ── Schémas ───────────────────────────────────────────────────────────────────

const narrativeSchema = z.object({
  narrative:    z.string().max(600).catch(''),
  usedFactIds:  z.array(z.string()).max(20).catch([]),
})

// Schéma Gemini natif — contraint la structure de sortie au niveau du provider.
const GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    narrative:   { type: 'STRING' },
    usedFactIds: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['narrative', 'usedFactIds'],
}

// ── Prompt système ────────────────────────────────────────────────────────────

const SYSTEM = `Tu es un assistant MemorIA. À partir UNIQUEMENT des données JSON fournies, produis une synthèse de 1 à 2 phrases en français décrivant l'état d'un sujet de chantier de construction.

Ordre de priorité : état actuel → évolution ou stagnation → conséquence relationnelle → acteur.
Si une donnée est absente, omets-la naturellement. Ne jamais inférer, inventer, ni compléter par vraisemblance.
Ton neutre, factuel. Pas de formules creuses ni de politesse.
Dans usedFactIds, liste uniquement les IDs des faits que tu as réellement mentionnés.

Réponds en JSON : { "narrative": "...", "usedFactIds": ["..."] }`

// ── Labels ────────────────────────────────────────────────────────────────────

const STATUS_FR: Record<string, string> = {
  open:                 'à réaliser / ouvert',
  in_progress:          'en cours',
  planned:              'planifié',
  done:                 'clôturé / réalisé',
  non_compliant:        'non conforme',
  awaiting_validation:  'en attente de validation',
  cancelled:            'annulé',
  informational:        'informatif',
  still_open:           'toujours ouvert',
  field_checked:        'vérifié sur le terrain',
  not_applicable:       'sans objet',
}

const LINK_FR: Record<string, { out: string; in: string }> = {
  requires:   { out: 'nécessite',       in: 'est requis par' },
  enables:    { out: 'conditionne',     in: 'est conditionné par' },
  causes:     { out: 'entraîne',        in: 'est causé par' },
  validates:  { out: 'valide',          in: 'est validé par' },
  replaces:   { out: 'remplace',        in: 'est remplacé par' },
  relates_to: { out: 'est lié à',      in: 'est lié à' },
}

// ── Construction de l'input structuré ────────────────────────────────────────

function buildInput(
  life: CanonicalSubjectLife,
  intel: CanonicalSubjectIntelligence,
): { input: Record<string, unknown>; factCount: number } {
  const input: Record<string, unknown> = { sujet: life.label }
  let factCount = 0

  if (life.currentStatus) {
    input.statut = { id: 'status', label: STATUS_FR[life.currentStatus] ?? life.currentStatus }
    factCount++
  }

  if (intel.isStagnant && intel.stagnationDays) {
    input.stagnation = {
      id: 'stagnation',
      jours: intel.stagnationDays,
      mentions_consecutives: intel.consecutiveMentionsWithoutChange + 1,
    }
    factCount++
  } else if (intel.lastMeaningfulChangeAt && intel.lastMeaningfulChangeAt !== life.lastSeenAt) {
    input.evolution_recente = { id: 'recent_change', date: intel.lastMeaningfulChangeAt.slice(0, 10) }
    factCount++
  }

  const confirmedLinks = life.links.filter((l) => l.status === 'confirmed').slice(0, 3)
  if (confirmedLinks.length > 0) {
    input.relations = confirmedLinks.map((l) => {
      const verb = LINK_FR[l.linkType]?.[l.direction === 'outgoing' ? 'out' : 'in'] ?? l.linkType
      const target = l.direction === 'outgoing' ? l.toLabel : l.fromLabel
      return { id: `link-${l.id}`, relation: verb, cible: target }
    })
    factCount++
  }

  if (intel.actor) {
    input.acteur = {
      id: 'actor',
      nom: intel.actor.name,
      role: intel.actor.role === 'company' ? 'entreprise' : 'personne',
    }
    factCount++
  }

  return { input, factCount }
}

// ── Parsing 3 niveaux (pattern commun aux services IA du projet) ──────────────

function parseResult(out: { parsed?: unknown; text: string }): z.infer<typeof narrativeSchema> | null {
  // 1. Sortie structurée du provider (priorité — actif quand geminiSchema est fourni)
  if (out.parsed !== undefined && out.parsed !== null) {
    const r = narrativeSchema.safeParse(out.parsed)
    if (r.success) return r.data
  }
  // 2. Parse direct du texte brut
  try {
    const r = narrativeSchema.safeParse(JSON.parse(out.text))
    if (r.success) return r.data
  } catch { /* ignore */ }
  // 3. Extraction du premier objet JSON (garde-fou si texte superflu avant/après)
  const start = out.text.indexOf('{')
  const end = out.text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const r = narrativeSchema.safeParse(JSON.parse(out.text.slice(start, end + 1)))
      if (r.success) return r.data
    } catch { /* ignore */ }
  }
  return null
}

// ── Fonction principale ───────────────────────────────────────────────────────

export async function buildSubjectNarrative(
  life: CanonicalSubjectLife,
  intel: CanonicalSubjectIntelligence,
  userId: string | null = null,
): Promise<SubjectNarrativeResult | null> {
  const { input, factCount } = buildInput(life, intel)

  // Pas assez de faits pour justifier une synthèse — le LLM répéterait juste le titre
  if (factCount < 2) return null

  const provider = getAIProvider()

  if (provider.name === 'mock') {
    const statusPart = life.currentStatus ? (STATUS_FR[life.currentStatus] ?? life.currentStatus) : null
    const base = statusPart ? `${life.label} est ${statusPart}` : life.label
    const stagPart = intel.isStagnant && intel.stagnationDays
      ? ` sans évolution significative depuis ${intel.stagnationDays} jours`
      : ''
    return { narrative: `[mock] ${base}${stagPart}.`, usedFactIds: [], model: 'mock' }
  }

  try {
    const result = await withAITracking('subject_narrative', userId, async () => {
      const out = await provider.complete({
        systemPrompt: SYSTEM,
        userMessage: JSON.stringify(input, null, 2),
        responseSchema: narrativeSchema,
        geminiSchema: GEMINI_SCHEMA,
        modelTier: 'light',
        maxOutputTokens: 150,
      })

      // Troncature → section absente (narrative partielle = pire que rien)
      const truncated = out.finishReason
        && out.finishReason !== 'STOP'
        && out.finishReason !== 'FINISH_REASON_UNSPECIFIED'
      const parsed = truncated ? null : parseResult(out)

      return {
        result: parsed?.narrative?.trim() ? parsed : null,
        tokens: out.tokens,
        model: out.model,
        provider: provider.name,
        durationMs: out.durationMs,
      }
    })

    if (!result?.narrative?.trim()) return null
    return {
      narrative: result.narrative.trim(),
      usedFactIds: result.usedFactIds ?? [],
      model: 'gemini',
    }
  } catch {
    return null
  }
}
