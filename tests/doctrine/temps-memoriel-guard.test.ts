// Garde-fous doctrine — Sprint D (l'oubli / temps mémoriel).
//
// Verrouille les ouvertures de Sprint D contre la dérive (doctrine-openings
// -pay-cost) :
//   - grammaire EXACTEMENT 4 états humains (anti sur-sémantisation) ;
//   - vocabulaire descriptif, jamais de score/ranking/confidence/obsolete ;
//   - sujet = mémoire/lieu, JAMAIS personne ;
//   - résolution réversible + non destructive (changement de statut, pas delete) ;
//   - migration additive (élargit le CHECK, ne supprime/efface rien).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_STATE_LABEL, MEMORY_STATE_MEANING, memoryState } from '@/lib/memory/temps-memoriel'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')
const stripComments = (s: string) =>
  s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Temps mémoriel — grammaire verrouillée à 4 états', () => {
  it('EXACTEMENT 4 états humains, pas un de plus', () => {
    expect(Object.keys(MEMORY_STATE_LABEL).sort()).toEqual(
      ['clos', 'present', 'remplace', 'sommeil'],
    )
    expect(Object.keys(MEMORY_STATE_MEANING).sort()).toEqual(
      ['clos', 'present', 'remplace', 'sommeil'],
    )
  })

  it('libellés humains exacts (vocabulaire figé)', () => {
    expect(MEMORY_STATE_LABEL.present).toBe('Présent')
    expect(MEMORY_STATE_LABEL.sommeil).toBe('En sommeil')
    expect(MEMORY_STATE_LABEL.clos).toBe('Clos')
    expect(MEMORY_STATE_LABEL.remplace).toBe('Remplacé')
  })

  it('mapping déterministe correct depuis les champs techniques', () => {
    expect(memoryState({ status: 'active' })).toBe('present')
    expect(memoryState({ status: 'stale' })).toBe('sommeil')
    expect(memoryState({ status: 'expired' })).toBe('sommeil')
    expect(memoryState({ status: 'resolved' })).toBe('clos')
    expect(memoryState({ status: 'superseded' })).toBe('remplace')
    // hors grammaire : ne s'affiche pas
    expect(memoryState({ status: 'dismissed' })).toBeNull()
    expect(memoryState({ status: 'archived' })).toBeNull()
    // expiry dépassé → sommeil même si statut actif
    expect(memoryState({ status: 'active', expiresAt: '2000-01-01T00:00:00Z' })).toBe('sommeil')
  })
})

describe('Temps mémoriel — anti dérive lexicale (pas de score/évaluation)', () => {
  const code = stripComments(read('lib/memory/temps-memoriel.ts')).toLowerCase()
  const forbidden = ['score', 'ranking', 'confidence', 'pertinen', 'obsolete', 'faible', 'decay']

  it('le helper n\'emploie aucun vocabulaire de scoring/évaluation', () => {
    for (const f of forbidden) {
      expect(code.includes(f), `temps-memoriel ne doit pas contenir '${f}'`).toBe(false)
    }
  })

  it('sujet = mémoire, JAMAIS personne (aucun champ de personne en entrée)', () => {
    const forbiddenPerson = ['user_id', 'userid', 'person', 'agent_id', 'employee', 'intervenant']
    for (const f of forbiddenPerson) {
      expect(code.includes(f), `temps-memoriel ne doit pas référencer '${f}'`).toBe(false)
    }
  })

  it('aucun import IA / embedding (déterministe pur)', () => {
    expect(/@anthropic|@google\/genai|getEmbedding|generateText|services\/ai/.test(read('lib/memory/temps-memoriel.ts'))).toBe(false)
  })
})

describe('Résolution de résonance — réversible et non destructive', () => {
  const src = read('app/(dashboard)/sites/[id]/resonance-actions.ts')

  it('resolveResonanceAction change le statut (jamais de delete)', () => {
    expect(/export async function resolveResonanceAction/.test(src)).toBe(true)
    const block = src.slice(src.indexOf('resolveResonanceAction'))
    expect(/update\(\{ status: 'resolved' \}\)/.test(block)).toBe(true)
    // aucune suppression dure dans le fichier d'actions
    expect(/\.delete\(\)/.test(src)).toBe(false)
  })

  it('réversibilité : reactivateResonanceAction repasse en active', () => {
    expect(/export async function reactivateResonanceAction/.test(src)).toBe(true)
    const block = src.slice(src.indexOf('reactivateResonanceAction'))
    expect(/update\(\{ status: 'active' \}\)/.test(block)).toBe(true)
  })

  it('audité (logAuditEvent) et gaté manager+', () => {
    expect(/kind: 'resonance_resolved'/.test(src)).toBe(true)
    expect(/requireManagerOrAdmin\(\)/.test(src)).toBe(true)
  })
})

describe('Migration 087 — additive et non destructive', () => {
  const sql = read('supabase/migrations/087_resonance_resolved_status.sql')

  it('élargit le CHECK pour inclure resolved', () => {
    expect(/CHECK \(status IN \([^)]*'resolved'[^)]*\)\)/.test(sql)).toBe(true)
  })

  it('ne supprime/efface aucune donnée', () => {
    expect(/DROP COLUMN|DELETE FROM|TRUNCATE/i.test(sql)).toBe(false)
  })
})
