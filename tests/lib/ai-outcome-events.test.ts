// Les invariants du contrat `trackAiOutcome` (lot 5.1A-1).
//
// Ce contrat mesure le devenir d'un résultat IA. Il touche une donnée sensible —
// l'usage — et sa raison d'être est d'exister À UN SEUL ENDROIT pour tenir quatre
// invariants qu'aucun composant ne doit pouvoir contourner. Ce fichier les
// verrouille sur le COMPORTEMENT (client mocké), pas sur la forme du code.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// On capture ce qui serait réellement écrit en base.
type Row = Record<string, unknown>
let inserted: Row | null = null
let insertOptions: Record<string, unknown> | null = null
let throwOnWrite = false

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        if (throwOnWrite) throw new Error('DB indisponible')
        if (table === 'usage_events') { inserted = row; insertOptions = opts }
        return { error: null }
      },
    }),
  }),
}))

// Org pilotable par test : le fail-closed se prouve en la rendant illisible.
let mockOrgId: string | null = 'org-123'
vi.mock('@/lib/db/users', () => ({
  getOrgId: async () => mockOrgId,
}))

import {
  trackAiOutcome,
  AI_CAPABILITIES,
  AI_OUTCOMES,
  AI_ARTIFACT_TYPES,
} from '@/lib/db/ai-outcome-events'

beforeEach(() => {
  inserted = null
  insertOptions = null
  throwOnWrite = false
  mockOrgId = 'org-123'
})

const VALID = {
  capability: 'visit_summary',
  outcome: 'displayed',
  artifactType: 'visit_report',
} as const

describe('Invariant 1 — NON BLOQUANT : ne lève jamais', () => {
  it('un échec d’écriture ne remonte pas', async () => {
    throwOnWrite = true
    await expect(trackAiOutcome(VALID)).resolves.toBeUndefined()
  })

  it('même avec des entrées incohérentes, aucune exception', async () => {
    // @ts-expect-error — on teste la robustesse à un appel mal typé.
    await expect(trackAiOutcome({})).resolves.toBeUndefined()
  })
})

describe('Invariant 2 — CLOISONNÉ par organisation', () => {
  it('écrit organization_id, et rien d’autre ne cloisonne', async () => {
    await trackAiOutcome(VALID)
    expect(inserted?.organization_id).toBe('org-123')
  })

  it('FAIL-CLOSED : sans organisation lisible, RIEN n’est écrit', async () => {
    // Même argument que searchMemory : perdre un événement sur une session
    // illisible est acceptable, écrire une ligne inter-tenant ne l'est pas.
    mockOrgId = null
    await trackAiOutcome(VALID)
    expect(inserted).toBeNull()
  })
})

describe('Invariant 3 — AUCUN CONTENU MÉTIER', () => {
  it('la ligne écrite ne porte ni meta, ni query, ni titre, ni texte libre', async () => {
    await trackAiOutcome({ ...VALID, artifactId: '11111111-1111-1111-1111-111111111111' })
    const keys = Object.keys(inserted ?? {})
    expect(keys).not.toContain('meta')
    expect(keys).not.toContain('query')
    // Aucune valeur écrite n'est du texte libre : `event` est dérivé des
    // dimensions fermées, tout le reste est une clé fermée, un uuid ou un nombre.
    expect(inserted?.event).toBe('ai_outcome:visit_summary:displayed')
  })

  it('la surface d’API ne permet pas de passer un texte métier', () => {
    // Test de CONTRAT : les seules clés acceptées sont fermées + techniques.
    // Si un champ texte libre apparaissait un jour, ce test devrait être revu
    // EXPLICITEMENT — il documente ce que le contrat refuse d'exposer.
    const allowed = new Set([
      'capability', 'outcome', 'artifactType',
      'artifactId', 'aiRunId', 'editRatio', 'latencySeconds', 'dedupeKey',
    ])
    for (const forbidden of ['title', 'text', 'summary', 'query', 'body', 'label', 'name']) {
      expect(allowed.has(forbidden)).toBe(false)
    }
  })
})

describe('Invariant 4 — AUCUNE DIMENSION INDIVIDUELLE', () => {
  it('user_id n’est JAMAIS écrit', async () => {
    await trackAiOutcome(VALID)
    expect(Object.keys(inserted ?? {})).not.toContain('user_id')
    expect(inserted?.user_id).toBeUndefined()
  })

  it('site_id n’est pas écrit non plus (pas de granularité de re-identification)', async () => {
    await trackAiOutcome(VALID)
    expect(inserted?.site_id).toBeUndefined()
  })
})

describe('Vocabulaire FERMÉ — hors liste = refus silencieux, pas d’écriture', () => {
  it('une capability inconnue n’écrit rien', async () => {
    // @ts-expect-error — valeur hors vocabulaire.
    await trackAiOutcome({ ...VALID, capability: 'chatgpt_libre' })
    expect(inserted).toBeNull()
  })

  it('un outcome inconnu n’écrit rien', async () => {
    // @ts-expect-error — outcome hors vocabulaire ferme.
    await trackAiOutcome({ ...VALID, outcome: 'liked' })
    expect(inserted).toBeNull()
  })

  it('un artifactType inconnu n’écrit rien', async () => {
    // @ts-expect-error — artifactType hors vocabulaire ferme.
    await trackAiOutcome({ ...VALID, artifactType: 'anything' })
    expect(inserted).toBeNull()
  })

  it('les trois vocabulaires sont non vides et cohérents avec la migration', () => {
    expect(AI_CAPABILITIES.length).toBeGreaterThan(0)
    expect(AI_OUTCOMES).toContain('acted_on')
    expect(AI_ARTIFACT_TYPES).toContain('visit_report')
  })

  it('la narration lue à l’écran (visit_debrief_understand) est un vocabulaire ACCEPTÉ', async () => {
    // 5.1A-2 : la capacité réellement affichée au conducteur. Miroir du CHECK
    // de la mig 226 — si l'une bouge sans l'autre, l'insert lèverait en prod.
    expect(AI_CAPABILITIES).toContain('visit_debrief_understand')
    await trackAiOutcome({
      capability: 'visit_debrief_understand',
      outcome: 'displayed',
      artifactType: 'visit_report',
      artifactId: '22222222-2222-2222-2222-222222222222',
      dedupeKey: '22222222-2222-2222-2222-222222222222:understand:v1',
    })
    expect(inserted?.ai_capability).toBe('visit_debrief_understand')
    expect(inserted?.event).toBe('ai_outcome:visit_debrief_understand:displayed')
    expect(inserted?.ai_dedupe_key).toBe('22222222-2222-2222-2222-222222222222:understand:v1')
  })
})

describe('Nombres — bornés et propres', () => {
  it('edit_ratio au-dessus de 1 est ramené à 1', async () => {
    await trackAiOutcome({ ...VALID, outcome: 'edited', editRatio: 1.8 })
    expect(inserted?.ai_edit_ratio).toBe(1)
  })

  it('edit_ratio négatif est ramené à 0', async () => {
    await trackAiOutcome({ ...VALID, outcome: 'edited', editRatio: -0.3 })
    expect(inserted?.ai_edit_ratio).toBe(0)
  })

  it('une latence négative ou non finie devient null', async () => {
    await trackAiOutcome({ ...VALID, latencySeconds: -5 })
    expect(inserted?.ai_latency_seconds).toBeNull()
  })

  it('un artifactId non-uuid est rejeté (jamais du texte libre déguisé en clé)', async () => {
    await trackAiOutcome({ ...VALID, artifactId: 'action à faire demain' })
    expect(inserted?.ai_artifact_id).toBeNull()
  })
})

describe('Dédup — un même fait ne compte qu’une fois', () => {
  it('la clé de dédup passe en on-conflict-do-nothing', async () => {
    await trackAiOutcome({ ...VALID, dedupeKey: 'summary-42-displayed' })
    expect(inserted?.ai_dedupe_key).toBe('summary-42-displayed')
    expect(insertOptions).toMatchObject({ onConflict: 'ai_dedupe_key', ignoreDuplicates: true })
  })

  it('une clé en texte libre (espaces, accents) = refus TOTAL, rien n’est écrit', async () => {
    // La clé est un IDENTIFIANT, pas un champ texte : sans cette garde, un
    // appelant pouvait y encoder un titre d'action. Et écrire quand même SANS
    // la clé gonflerait le signal (rerenders comptés N fois) : refus total.
    await trackAiOutcome({ ...VALID, dedupeKey: 'action à faire demain' })
    expect(inserted).toBeNull()
  })
})
