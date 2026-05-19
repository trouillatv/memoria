// A3 — recall documentaire BORNÉ dans l'analyse AO initiale (orchestrator).
//
// Contrainte principale : UN SEUL recall documentaire par analyse, JAMAIS
// un recall par agent. Tripwire structurel pur.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const orch = read('services/ai/orchestrator.ts')
const lecteur = read('services/ai/agents/lecteur-ao.ts')
const memo = read('services/ai/agents/memoire-technique.ts')
const scorer = read('services/ai/agents/opportunity-scorer.ts')

describe('A3 — recall doc 1×/analyse (orchestrator)', () => {
  it('buildDocumentContext appelé EXACTEMENT une fois (hors boucle/agent)', () => {
    const calls = orch.match(/\bbuildDocumentContext\(/g) ?? []
    expect(calls.length, 'un seul appel buildDocumentContext').toBe(1)
  })

  it('le recall est calculé AVANT tout agent (pas dans withAITracking)', () => {
    const callIdx = orch.indexOf('buildDocumentContext({')
    const firstAgent = orch.indexOf("withAITracking('lecteur_ao'")
    expect(callIdx).toBeGreaterThan(-1)
    expect(firstAgent).toBeGreaterThan(-1)
    expect(callIdx).toBeLessThan(firstAgent)
  })

  it('rôle dérivé du userId → visibility_level respecté', () => {
    expect(/userId\s*\?\s*await getUserRoleById\(userId\)\s*:\s*null/.test(orch)).toBe(true)
    expect(/buildDocumentContext\(\{\s*query:\s*rawText,\s*role\s*\}\)/.test(orch)).toBe(true)
  })

  it('ctx.documentContext alimenté depuis le recall borné', () => {
    expect(/documentContext:\s*docCtx\.promptBlock/.test(orch)).toBe(true)
  })

  it('agents concernés (lecteur_ao, memoire_technique) injectent un bloc BORNÉ', () => {
    for (const [name, src] of [['lecteur', lecteur], ['memoire', memo]] as const) {
      expect(
        /ctx\.documentContext[\s\S]{0,80}?\.slice\(0,\s*6000\)/.test(src),
        `${name} : slice défensif borné absent`,
      ).toBe(true)
      // Jamais en mode mock (cohérent fixtures).
      expect(src).toContain('isMock')
    }
  })

  it('opportunity_scorer NON concerné (pas de documentContext)', () => {
    expect(/ctx\.documentContext/.test(scorer)).toBe(false)
  })

  it('gracieux : pas de provider/match → analyse continue (promptBlock vide)', () => {
    // buildDocumentContext renvoie EMPTY (promptBlock '') si pas de provider ;
    // docBlock devient '' → aucun ajout, aucune erreur.
    expect(/ctx\.documentContext\s*\?\s*`/.test(lecteur)).toBe(true)
    expect(/:\s*''/.test(lecteur)).toBe(true)
  })

  it('aucun import génératif supplémentaire dans l\'orchestrator', () => {
    const head = orch.slice(0, 700)
    expect(
      /@anthropic-ai|@google\/genai|generateText|services\/ai\/chat|engagement-extraction/.test(head),
    ).toBe(false)
  })
})
