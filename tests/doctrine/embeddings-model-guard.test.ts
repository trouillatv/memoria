// Tripwire structurel sur lib/ai/embeddings.ts.
//
// Google a déprécié text-embedding-004 (404 sur :embedContent v1beta,
// confirmé 2026-05-20). Le modèle GA est gemini-embedding-001.
//
// Ce test verrouille le choix de modèle pour éviter une régression
// silencieuse (le pipeline embed renverrait null, et tout downstream
// — knowledge_chunks, trace_embeddings, B1/B2/AO recall — produirait
// 0 ligne sans erreur visible).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const src = readFileSync(join(ROOT, 'lib/ai/embeddings.ts'), 'utf-8')

describe('embeddings — modèle Google verrouillé', () => {
  it('GOOGLE_MODEL = gemini-embedding-001 (text-embedding-004 déprécié)', () => {
    expect(/GOOGLE_MODEL\s*=\s*['"]gemini-embedding-001['"]/.test(src)).toBe(true)
  })

  it('text-embedding-004 banni du fichier (anti-régression)', () => {
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/text-embedding-004/.test(codeOnly)).toBe(false)
  })

  it('outputDimensionality: 768 conservé (compat schéma migration 053)', () => {
    expect(/outputDimensionality:\s*768/.test(src)).toBe(true)
  })
})
