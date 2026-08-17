// P6-A1 — spike de segmentation LLM contrainte.
//
// Ce fichier prouve trois choses distinctes :
//   1. `parseDecomposition` est un durcisseur PUR : toute sortie LLM invalide,
//      incohérente, ou ambiguous:true est rejetée (→ null), sans jamais faire
//      confiance à un texte fourni par le LLM (seul `rawText.slice` compte).
//   2. `decomposeUtterance` est ROBUSTE : LLM absent, lent ou en erreur →
//      repli mono-segment garanti, jamais d'exception, jamais de `null`.
//   3. `routeSegments` délègue CHAQUE segment au routeur déterministe existant
//      et inchangé (`detectIntent`) — ce module ne classe rien lui-même.
//
// Ce que ce fichier NE prouve PAS : la justesse du découpage LLM réel sur le
// corpus des 50 phrases. Voir scripts/_spike-p6a-decompose-eval.ts.

import { describe, it, expect } from 'vitest'
import {
  parseDecomposition,
  monoSegmentFallback,
  decomposeUtterance,
  routeSegments,
  MAX_SEGMENTS,
  type DecompositionResult,
} from '@/lib/visits/copilot-decompose'
import { detectIntent } from '@/lib/visits/copilot-intent-router'
import type { AIProvider, CompletionOutput } from '@/services/ai'

// ── Helpers ───────────────────────────────────────────────────────────────────

function provider(impl: () => Promise<CompletionOutput>): AIProvider {
  return { name: 'mock', complete: impl }
}

function output(parsed: unknown, text = ''): CompletionOutput {
  return { text, parsed, tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1 }
}

/** Construit un segment par sous-chaîne plutôt que par index compté à la main. */
function seg(text: string, sub: string, dependsOn: number | null = null) {
  const start = text.indexOf(sub)
  if (start === -1) throw new Error(`"${sub}" introuvable dans "${text}"`)
  return { start, end: start + sub.length, dependsOn }
}

// ── 1. parseDecomposition — durcissement pur ──────────────────────────────────

describe('parseDecomposition — structure hors contrat', () => {
  const text = 'Le portail est cassé. Planifie une réunion vendredi.'

  it('rejette une valeur non objet', () => {
    expect(parseDecomposition(text, 'segments')).toBeNull()
  })

  it('rejette une structure incomplète', () => {
    expect(parseDecomposition(text, { segments: [] })).toBeNull()
  })

  it('rejette plus de MAX_SEGMENTS segments', () => {
    const many = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({ start: i, end: i + 1, dependsOn: null }))
    expect(parseDecomposition('0123456789', { segments: many, ambiguous: false })).toBeNull()
  })

  it('ambiguous:true déclaré par le LLM → repli décidé par l’appelant, pas ici', () => {
    const raw = { segments: [seg(text, 'Le portail est cassé')], ambiguous: true }
    expect(parseDecomposition(text, raw)).toBeNull()
  })
})

describe('parseDecomposition — bornes, ordre, chevauchement', () => {
  const text = 'Le portail est cassé. Planifie une réunion vendredi.'

  it('accepte un découpage correct et non chevauchant', () => {
    const raw = {
      segments: [seg(text, 'Le portail est cassé'), seg(text, 'Planifie une réunion vendredi')],
      ambiguous: false,
    }
    const result = parseDecomposition(text, raw)
    expect(result).not.toBeNull()
    expect(result?.segments).toHaveLength(2)
    expect(result?.ambiguous).toBe(false)
  })

  it('rejette un end au-delà de la longueur du texte', () => {
    const raw = { segments: [{ start: 0, end: text.length + 10, dependsOn: null }], ambiguous: false }
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('rejette un segment vide (start === end)', () => {
    const raw = { segments: [{ start: 5, end: 5, dependsOn: null }], ambiguous: false }
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('rejette un segment ne couvrant que des espaces', () => {
    const raw = { segments: [{ start: 21, end: 23, dependsOn: null }], ambiguous: false } // ". " entre les deux phrases
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('rejette deux segments qui se chevauchent', () => {
    const a = seg(text, 'Le portail est cassé')
    const raw = {
      segments: [a, { start: a.end - 3, end: a.end + 5, dependsOn: null }],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('rejette un ordre non croissant', () => {
    const raw = {
      segments: [seg(text, 'Planifie une réunion vendredi'), seg(text, 'Le portail est cassé')],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })
})

describe('parseDecomposition — dependsOn n’est jamais une résolution d’anaphore', () => {
  const text = 'Le SSI est en panne. Rappelle le prestataire pour ça.'

  it('accepte un dependsOn vers un segment strictement antérieur', () => {
    const raw = {
      segments: [seg(text, 'Le SSI est en panne'), seg(text, 'Rappelle le prestataire pour ça', 0)],
      ambiguous: false,
    }
    const result = parseDecomposition(text, raw)
    expect(result?.segments[1].dependsOn).toBe(0)
  })

  it('rejette un dependsOn vers lui-même', () => {
    const raw = {
      segments: [
        { ...seg(text, 'Le SSI est en panne'), dependsOn: 0 },
        seg(text, 'Rappelle le prestataire pour ça'),
      ],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('rejette un dependsOn vers un segment futur', () => {
    const raw = {
      segments: [seg(text, 'Le SSI est en panne', 1), seg(text, 'Rappelle le prestataire pour ça')],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })
})

describe('parseDecomposition — aucune perte silencieuse de texte métier', () => {
  it('rejette un découpage qui laisse un signal métier hors segment', () => {
    // "ajoute" (verbe d'écriture) tombe dans l'intervalle NON couvert entre les
    // deux segments proposés : la coupure a mal placé la frontière.
    const text = 'Le portail est cassé et ajoute une action pour le sous-traitant.'
    const raw = {
      segments: [
        { start: 0, end: text.indexOf('et ajoute'), dependsOn: null },
        { start: text.indexOf('pour le sous-traitant'), end: text.length - 1, dependsOn: null },
      ],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })

  it('tolère un connecteur court et inerte entre deux segments ("donc", ". ")', () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const raw = {
      segments: [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain')],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).not.toBeNull()
  })

  it('rejette un intervalle inerte mais trop long (perte potentielle)', () => {
    const filler = 'x'.repeat(40) // inerte pour detectIntent, mais dépasse MAX_GAP_CHARS
    const text = `Le portail est cassé. ${filler} Rappelle le prestataire demain.`
    const raw = {
      segments: [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain')],
      ambiguous: false,
    }
    expect(parseDecomposition(text, raw)).toBeNull()
  })
})

// ── 2. Repli garanti ────────────────────────────────────────────────────────

describe('monoSegmentFallback', () => {
  it('couvre tout le texte et se déclare ambiguous', () => {
    const text = 'Une phrase quelconque.'
    const fb = monoSegmentFallback(text)
    expect(fb).toEqual<DecompositionResult>({
      segments: [{ start: 0, end: text.length, dependsOn: null }],
      ambiguous: true,
    })
  })
})

describe('decomposeUtterance — robustesse (le Copilote doit fonctionner sans LLM)', () => {
  it('texte trop court → repli sans appel LLM', async () => {
    let called = false
    const p = provider(async () => { called = true; return output({}) })
    const result = await decomposeUtterance('ok', { provider: p })
    expect(called).toBe(false)
    expect(result.ambiguous).toBe(true)
  })

  it('LLM indisponible (exception) → repli mono-segment', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const p = provider(async () => { throw new Error('provider down') })
    const result = await decomposeUtterance(text, { provider: p })
    expect(result).toEqual(monoSegmentFallback(text))
  })

  it('JSON invalide → repli mono-segment', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const p = provider(async () => output(undefined, 'pas du json'))
    const result = await decomposeUtterance(text, { provider: p })
    expect(result).toEqual(monoSegmentFallback(text))
  })

  it('LLM trop lent → repli mono-segment (timeout, pas d’attente)', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const p = provider(() => new Promise<CompletionOutput>(() => { /* ne résout jamais */ }))
    const result = await decomposeUtterance(text, { provider: p, timeoutMs: 30 })
    expect(result).toEqual(monoSegmentFallback(text))
  })

  it('ambiguous:true du LLM → repli mono-segment, jamais arbitré', async () => {
    const text = 'Le portail est cassé donc c’est le sous-traitant qui doit revenir.'
    const p = provider(async () => output({
      segments: [{ start: 0, end: text.length, dependsOn: null }],
      ambiguous: true,
    }))
    const result = await decomposeUtterance(text, { provider: p })
    expect(result).toEqual(monoSegmentFallback(text))
  })

  it('sortie LLM valide et multi-segments → conservée telle quelle', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const segments = [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain')]
    const p = provider(async () => output({ segments, ambiguous: false }))
    const result = await decomposeUtterance(text, { provider: p })
    expect(result.ambiguous).toBe(false)
    expect(result.segments).toHaveLength(2)
  })

  it('onRawCall reçoit la sortie brute du provider après un appel réussi', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const segments = [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain')]
    const raw = output({ segments, ambiguous: false })
    const p = provider(async () => raw)
    let captured: CompletionOutput | null = null
    await decomposeUtterance(text, { provider: p, onRawCall: (o) => { captured = o } })
    expect(captured).toBe(raw)
  })

  it('récupère le JSON depuis le texte brut quand parsed est absent', async () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const segments = [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain')]
    const raw = '```json\n' + JSON.stringify({ segments, ambiguous: false }) + '\n```'
    const p = provider(async () => output(undefined, raw))
    const result = await decomposeUtterance(text, { provider: p })
    expect(result.ambiguous).toBe(false)
    expect(result.segments).toHaveLength(2)
  })
})

// ── 3. routeSegments — délégation intégrale au routeur existant ───────────────

describe('routeSegments — ce module ne classe jamais rien lui-même', () => {
  it('reconstruit le texte via slice et appelle detectIntent, inchangé, par segment', () => {
    const text = 'Le portail est cassé. Rappelle le prestataire demain.'
    const result: DecompositionResult = {
      segments: [seg(text, 'Le portail est cassé'), seg(text, 'Rappelle le prestataire demain', 0)],
      ambiguous: false,
    }
    const routed = routeSegments(text, result)

    expect(routed).toHaveLength(2)
    expect(routed[0].text).toBe('Le portail est cassé')
    expect(routed[1].text).toBe('Rappelle le prestataire demain')
    expect(routed[1].dependsOn).toBe(0)
    expect(routed[0].intent).toEqual(detectIntent('Le portail est cassé'))
    expect(routed[1].intent).toEqual(detectIntent('Rappelle le prestataire demain'))
  })

  it('un repli mono-segment se route en un seul appel à detectIntent', () => {
    const text = 'Une phrase quelconque à router telle quelle.'
    const routed = routeSegments(text, monoSegmentFallback(text))
    expect(routed).toHaveLength(1)
    expect(routed[0].text).toBe(text)
    expect(routed[0].intent).toEqual(detectIntent(text))
  })
})
