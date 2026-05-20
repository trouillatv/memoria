// B2 — tripwires structurels sur lib/documents/cross-store-resonances.ts
// (orchestrateur server-only) + hook dans analyze.ts.
//
// Spec : docs/superpowers/notes/2026-05-20-b2-etude-cross-store-bridge.md
//        (ratifiée Vincent 2026-05-20).
//
// Couverture doctrinale :
//  - server-only confirmé (import 'server-only' présent) ;
//  - zéro LLM/orchestrateur/agent/generateText ;
//  - zéro embedding nouveau (pas de embedDocumentChunks/embedQuery) ;
//  - RPC pgvector réutilisée (findSimilarTraces existante) ;
//  - filtrage AMONT par document_links + source_id (pas de scan
//    tenant-wide aveugle) ;
//  - filtres en AND : type, visibility, chunk action, cosine, trace
//    actionable, tenant match ;
//  - réutilisation site_reading_candidates (zéro migration) ;
//  - algorithm_version='b2_doc_trace_v1' figé ;
//  - plafond ≤2 actives par site ;
//  - 2 sources obligatoires (document + trace) ;
//  - fire-and-forget après 'ready' dans analyze.ts (pattern A3).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const src = read('lib/documents/cross-store-resonances.ts')
const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('B2 T2 — server-only orchestrator structurel', () => {
  it('import \'server-only\' présent (hors graphe tests)', () => {
    expect(/^import 'server-only'/m.test(src)).toBe(true)
  })

  it('aucun import IA / LLM / orchestrateur / agent', () => {
    expect(
      /@anthropic-ai|@google\/genai|generateText|services\/ai\/orchestrator|services\/ai\/agents\/|services\/ai\/chat/.test(codeOnly),
      'B2 doit rester déterministe',
    ).toBe(false)
  })

  it('aucun embedding nouveau (pas de embedDocumentChunks/embedQuery/getEmbedding)', () => {
    expect(/embedDocumentChunks|embedQuery|getEmbedding\(/.test(codeOnly)).toBe(false)
  })

  it('utilise findSimilarTraces existante (RPC pgvector réutilisée)', () => {
    expect(/findSimilarTraces/.test(codeOnly)).toBe(true)
  })

  it('aucun scan tenant-wide aveugle (pas de find_similar_knowledge_chunks ni rpc sans filtre)', () => {
    expect(/find_similar_knowledge_chunks/.test(codeOnly)).toBe(false)
    // Filtrage AMONT par source_id documenté
    expect(/eq\(['"]source_id['"],\s*documentId\)/.test(codeOnly)).toBe(true)
    expect(/eq\(['"]source_domain['"],\s*['"]document['"]\)/.test(codeOnly)).toBe(true)
  })

  it('filtre AMONT par document_links target_type=site', () => {
    expect(/from\(['"]document_links['"]\)/.test(codeOnly)).toBe(true)
    expect(/eq\(['"]target_type['"],\s*['"]site['"]\)/.test(codeOnly)).toBe(true)
  })

  it('filtre type ∈ B2_DOC_TYPES_ALLOWED appliqué', () => {
    expect(/B2_DOC_TYPES_ALLOWED[\s\S]{0,60}?includes\(d\.document_type\)/.test(codeOnly)).toBe(true)
  })

  it('filtre visibility ∈ B2_VISIBILITY_ALLOWED appliqué (défense en profondeur)', () => {
    expect(/B2_VISIBILITY_ALLOWED[\s\S]{0,60}?includes\(d\.visibility_level\)/.test(codeOnly)).toBe(true)
  })

  it('filtre chunk action (chunkSignalsAction) appliqué AVANT cosine', () => {
    expect(/chunks\.filter\([\s\S]{0,40}?chunkSignalsAction/.test(codeOnly)).toBe(true)
  })

  it('seuil cosine appliqué : m.similarity < B2_COSINE_THRESHOLD → skip', () => {
    expect(/m\.similarity\s*<\s*B2_COSINE_THRESHOLD/.test(codeOnly)).toBe(true)
  })

  it('filtre trace actionable (traceSignalsActionable) appliqué APRÈS cosine', () => {
    expect(/traceSignalsActionable\(traceKind/.test(codeOnly)).toBe(true)
  })

  it('vérification cross-tenant defensive (doc.tenant_id vs site.tenant_id)', () => {
    expect(/doc\.tenant_id\s*&&\s*doc\.tenant_id\s*!==\s*tenantId/.test(codeOnly)).toBe(true)
  })

  it('réutilisation site_reading_candidates avec reading_type=resonance', () => {
    expect(/site_reading_candidates/.test(codeOnly)).toBe(true)
    expect(/reading_type:\s*['"]resonance['"]/.test(codeOnly)).toBe(true)
    // Pas de NEW reading_type bricolé
    expect(/reading_type:\s*['"](?!resonance['"]).+['"]/.test(codeOnly)).toBe(false)
  })

  it('algorithm_version=B2_ALGO (constante = v2 désormais)', () => {
    expect(/algorithm_version:\s*B2_ALGO/.test(codeOnly)).toBe(true)
  })

  it('plafond ≤ B2_MAX_PER_SITE appliqué (cap actives)', () => {
    expect(/all\.length\s*>\s*B2_MAX_PER_SITE/.test(codeOnly)).toBe(true)
    expect(/like\(['"]algorithm_version['"],\s*['"]b2_doc_trace_%['"]\)/.test(codeOnly)).toBe(true)
  })

  it('2 sources obligatoires (document + trace) dans source_ids', () => {
    expect(/type:\s*['"]document['"]/.test(codeOnly)).toBe(true)
    expect(/type:\s*['"]trace['"]/.test(codeOnly)).toBe(true)
  })

  it('V2 — fragment construit via buildB2FragmentV2 (avec snippet)', () => {
    expect(/buildB2FragmentV2\(/.test(codeOnly)).toBe(true)
    expect(/snippet/.test(codeOnly)).toBe(true)
  })

  it('V2 — extractActionSnippet appelé sur chunk_text du match', () => {
    expect(/extractActionSnippet\(/.test(codeOnly)).toBe(true)
  })

  it('V2 — skip si snippet vide (jamais de fragment sans snippet)', () => {
    expect(/if\s*\(!snippet\)\s*continue/.test(codeOnly)).toBe(true)
  })

  it('V2 — dedup per-trace (stale autres B2 actifs sur même trace)', () => {
    expect(/src\[1\]\?\.type\s*===\s*['"]trace['"]/.test(codeOnly)).toBe(true)
    expect(/src\[1\]\?\.id\s*===\s*c\.traceId/.test(codeOnly)).toBe(true)
  })

  it('expires_at = B2_EXPIRE_DAYS jours', () => {
    expect(/B2_EXPIRE_DAYS\s*\*\s*86_?400_?000/.test(codeOnly)).toBe(true)
  })

  it('idempotence : stale anciens B2 actifs avec même doc en source[0] avant insert', () => {
    expect(/status:\s*['"]stale['"]/.test(codeOnly)).toBe(true)
    // V2 : on stale TOUTES les versions B2 (v1+v2) pour migration propre,
    // donc `.like('b2_doc_trace_%')` au lieu de `.eq(B2_ALGO)`.
    expect(/like\(['"]algorithm_version['"],\s*['"]b2_doc_trace_%['"]\)/.test(codeOnly)).toBe(true)
    expect(/src\[0\]\?\.id\s*===\s*doc\.id/.test(codeOnly)).toBe(true)
  })

  it('aucun internal_score / confidence / pourcentage écrit en DB', () => {
    expect(/internal_score|confidence|score:\s*\d/.test(codeOnly)).toBe(false)
  })

  it('fragment construit via buildB2FragmentV2 (pas de concat manuelle, v2)', () => {
    expect(/buildB2FragmentV2\(/.test(codeOnly)).toBe(true)
  })

  it('fire-and-forget : try/catch silencieux + .catch(() => {})', () => {
    expect(/\.catch\(\(\)\s*=>\s*\{\}\)/.test(codeOnly)).toBe(true)
  })
})

describe('B2 T3 — hook dans analyze.ts', () => {
  const analyze = read('lib/documents/analyze.ts')

  it('hook B2 placé APRÈS status=ready (cohérent B1)', () => {
    const readyIdx = analyze.indexOf("updateDocumentAnalysisStatus(documentId, 'ready')")
    const b2Idx = analyze.indexOf('computeDocCrossStoreResonancesForDocument')
    expect(readyIdx).toBeGreaterThan(-1)
    expect(b2Idx).toBeGreaterThan(-1)
    expect(b2Idx).toBeGreaterThan(readyIdx)
  })

  it('hook B2 placé APRÈS hook B1 (B2 est strictement additif)', () => {
    const b1Idx = analyze.indexOf('computeDocResonancesForDocument')
    const b2Idx = analyze.indexOf('computeDocCrossStoreResonancesForDocument')
    expect(b1Idx).toBeGreaterThan(-1)
    expect(b2Idx).toBeGreaterThan(b1Idx)
  })

  it('import dynamique (pattern A3, garde server-only hors graphe statique)', () => {
    expect(/await import\(['"]\.\/cross-store-resonances['"]\)/.test(analyze)).toBe(true)
  })

  it('fire-and-forget : void + .catch silencieux', () => {
    const b2Block = analyze.slice(analyze.indexOf('B2 —'))
    expect(/void computeDocCrossStoreResonancesForDocument\(documentId\)\.catch/.test(b2Block)).toBe(true)
  })
})
