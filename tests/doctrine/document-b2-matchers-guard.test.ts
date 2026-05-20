// B2 — tests purs (matchers + template fragment) + tripwires
// structurels sur lib/documents/cross-store-matchers.ts.
//
// Spec : docs/superpowers/notes/2026-05-20-b2-etude-cross-store-bridge.md
//        (ratifiée Vincent 2026-05-20, Q1 renforcée « aider à agir »).
//
// Couverture doctrinale :
//  - cosine threshold 0.80 (haut, β strict) ;
//  - plafond /2 par site (séparé B1) ;
//  - juridiques exclus d'office des types acceptés ;
//  - visibility ∈ {operations, field} uniquement ;
//  - filtre 1 : action signalée dans chunk doc (sinon refus) ;
//  - filtre 2 : trace actionnable (kind ou keyword issue) ;
//  - épistémologie « semble en écho » (jamais vérité affirmée) ;
//  - 2 sources obligatoires (doc + trace dans template).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  B2_COSINE_THRESHOLD,
  B2_TOP_K_PER_CHUNK,
  B2_MAX_PER_SITE,
  B2_EXPIRE_DAYS,
  B2_ALGO,
  B2_DOC_TYPES_ALLOWED,
  B2_VISIBILITY_ALLOWED,
  B2_TRACE_KINDS_ACTIONABLE,
  B2_ACTION_LEXICON_SIZE,
  B2_ISSUE_KEYWORDS_SIZE,
  chunkSignalsAction,
  traceSignalsActionable,
  buildB2Fragment,
  buildB2FragmentV2,
  extractActionSnippet,
  frDayMonth,
} from '@/lib/documents/cross-store-matchers'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

// =============================================================================
// Constantes — verrous doctrinaux
// =============================================================================

describe('B2 constantes — verrous doctrinaux', () => {
  it('seuil cosine 0.80 (haut, β strict ratifié)', () => {
    expect(B2_COSINE_THRESHOLD).toBe(0.80)
  })
  it('Top-K = 1 (un seul match par chunk/site)', () => {
    expect(B2_TOP_K_PER_CHUNK).toBe(1)
  })
  it('plafond /2 par site (séparé du B1 ≤3)', () => {
    expect(B2_MAX_PER_SITE).toBe(2)
  })
  it('expires 30 jours', () => {
    expect(B2_EXPIRE_DAYS).toBe(30)
  })
  it('algorithm_version namespacé b2_doc_trace_v2 (bump 2026-05-20 : snippet + dedup)', () => {
    expect(B2_ALGO).toBe('b2_doc_trace_v2')
    expect(B2_ALGO.startsWith('b2_doc_')).toBe(true)
  })
  it('types autorisés excluent les juridiques', () => {
    const allowed = [...B2_DOC_TYPES_ALLOWED] as readonly string[]
    for (const t of ['contrat', 'avenant', 'litige', 'facture', 'memoire_technique', 'ao', 'reference', 'autre']) {
      expect(allowed.includes(t), `${t} doit être exclu B2`).toBe(false)
    }
    expect(allowed).toEqual(['plan_acces', 'securite', 'procedure', 'protocole'])
  })
  it('visibility autorisée = operations/field UNIQUEMENT', () => {
    expect([...B2_VISIBILITY_ALLOWED]).toEqual(['operations', 'field'])
  })
  it('trace kinds actionnables par construction', () => {
    expect([...B2_TRACE_KINDS_ACTIONABLE]).toEqual([
      'anomaly', 'access_incident', 'site_note_a_savoir',
    ])
  })
  it('lexique action non vide (≥ 20 tokens — sinon perte de couverture)', () => {
    expect(B2_ACTION_LEXICON_SIZE).toBeGreaterThanOrEqual(20)
  })
  it('keywords issue non vide (≥ 15 tokens)', () => {
    expect(B2_ISSUE_KEYWORDS_SIZE).toBeGreaterThanOrEqual(15)
  })
})

// =============================================================================
// Filtre 1 — chunkSignalsAction
// =============================================================================

describe('B2 — chunkSignalsAction (lien utile = action citée)', () => {
  it('détecte un verbe d\'action infinitif', () => {
    expect(chunkSignalsAction('Il faut fermer la porte après usage.')).toBe(true)
    expect(chunkSignalsAction('Procéder à nettoyer la zone humide.')).toBe(true)
  })
  it('détecte un substantif d\'action (procédure, protocole, intervention…)', () => {
    expect(chunkSignalsAction('La procédure suivante s\'applique.')).toBe(true)
    expect(chunkSignalsAction('Protocole de nettoyage en vigueur.')).toBe(true)
  })
  it('détecte un marqueur d\'obligation', () => {
    expect(chunkSignalsAction('Le port du badge est obligatoire.')).toBe(true)
    expect(chunkSignalsAction('Accès interdit sans autorisation.')).toBe(true)
  })
  it('REJETTE un chunk descriptif sans action (anti faux-lien)', () => {
    expect(chunkSignalsAction('Ce document décrit les politiques générales.')).toBe(false)
    expect(chunkSignalsAction('Présentation de l\'entreprise et de ses sites.')).toBe(false)
  })
  it('REJETTE le domaine seul (« sécurité » sans action) — anti dilution', () => {
    // Un doc "securite" entier ne doit pas matcher juste parce que le mot
    // "sécurité" apparaît — il faut un verbe ou substantif d'action concret.
    expect(chunkSignalsAction('Sécurité sécurité sécurité du personnel.')).toBe(false)
  })
  it('insensible à la casse et aux diacritiques', () => {
    expect(chunkSignalsAction('FERMER LA PORTE')).toBe(true)
    expect(chunkSignalsAction('Vérifier l\'état du sas.')).toBe(true)
    expect(chunkSignalsAction('VÉRIFIER')).toBe(true)
  })
  it('texte vide → false', () => {
    expect(chunkSignalsAction('')).toBe(false)
  })
})

// =============================================================================
// Filtre 2 — traceSignalsActionable
// =============================================================================

describe('B2 — traceSignalsActionable (trace appelle une action)', () => {
  it('kind=anomaly → true direct (texte null OK)', () => {
    expect(traceSignalsActionable('anomaly', null)).toBe(true)
    expect(traceSignalsActionable('anomaly', 'tout va bien')).toBe(true)
  })
  it('kind=access_incident → true direct', () => {
    expect(traceSignalsActionable('access_incident', null)).toBe(true)
  })
  it('kind=site_note_a_savoir → true direct (consigne explicite)', () => {
    expect(traceSignalsActionable('site_note_a_savoir', 'Badge frigo HS')).toBe(true)
  })
  it('kind=site_note neutre sans issue → false', () => {
    expect(traceSignalsActionable('site_note', 'Intervention effectuée dans les délais.')).toBe(false)
    expect(traceSignalsActionable('site_note', 'Tout s\'est bien passé.')).toBe(false)
  })
  it('kind=site_note avec issue keyword → true', () => {
    expect(traceSignalsActionable('site_note', 'Le sol était glissant ce matin.')).toBe(true)
    expect(traceSignalsActionable('site_note', 'Badge bloqué à l\'entrée.')).toBe(true)
    expect(traceSignalsActionable('site_note', 'Robinet en panne au sous-sol.')).toBe(true)
  })
  it('kind=intervention neutre → false', () => {
    expect(traceSignalsActionable('intervention', 'Nettoyage des sols réalisé.')).toBe(false)
  })
  it('kind=intervention avec issue keyword → true', () => {
    expect(traceSignalsActionable('intervention', 'Tâche interrompue : fuite découverte.')).toBe(true)
  })
  it('insensible diacritiques', () => {
    expect(traceSignalsActionable('site_note', 'Mur fissuré côté Nord.')).toBe(true)
    expect(traceSignalsActionable('site_note', 'Sol mouillé au passage.')).toBe(true)
  })
  it('kind inconnu + texte vide → false (défaut sûr)', () => {
    expect(traceSignalsActionable('unknown_kind', '')).toBe(false)
    expect(traceSignalsActionable('unknown_kind', null)).toBe(false)
  })
})

// =============================================================================
// Template fragment B2
// =============================================================================

describe('B2 — buildB2Fragment', () => {
  const params = {
    docId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    docType: 'procedure',
    traceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    traceKind: 'site_note',
    traceDateIso: '2026-05-19T08:00:00Z',
  }

  it('contient les 2 IDs (sources obligatoires)', () => {
    const f = buildB2Fragment(params)
    expect(f).toContain('[doc:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]')
    expect(f).toContain('[trace:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb]')
  })

  it('épistémologie « semble en écho » (plausible, pas vérité)', () => {
    expect(buildB2Fragment(params)).toContain('semble en écho')
  })

  it('JAMAIS de wording affirmatif type « prouve », « démontre », « confirme »', () => {
    const f = buildB2Fragment(params).toLowerCase()
    expect(f).not.toMatch(/prouve|démontre|demontre|confirme|certifie|établit|etablit/)
  })

  it('JAMAIS de score / pourcentage / confidence dans le fragment', () => {
    const f = buildB2Fragment(params)
    expect(f).not.toMatch(/%|score|confiden|cosinus|cosine|0\.\d/i)
  })

  it('intro doctype accord grammatical (procédure → « rattachée »)', () => {
    expect(buildB2Fragment({ ...params, docType: 'procedure' })).toContain('procédure rattachée')
    expect(buildB2Fragment({ ...params, docType: 'protocole' })).toContain('protocole rattaché')
    expect(buildB2Fragment({ ...params, docType: 'plan_acces' })).toContain("plan d'accès rattaché")
    expect(buildB2Fragment({ ...params, docType: 'securite' })).toContain('consigne de sécurité rattachée')
  })

  it('label trace par kind', () => {
    expect(buildB2Fragment({ ...params, traceKind: 'anomaly' })).toContain('anomalie signalée')
    expect(buildB2Fragment({ ...params, traceKind: 'access_incident' })).toContain("incident d'accès")
    expect(buildB2Fragment({ ...params, traceKind: 'site_note_a_savoir' })).toContain('savoir terrain')
    expect(buildB2Fragment({ ...params, traceKind: 'site_note' })).toContain('note terrain')
  })

  it('date au format français court en fuseau Nouméa (déterministe)', () => {
    expect(frDayMonth('2026-05-19T00:00:00Z')).toBe('19 mai')
  })

  it('déterministe : mêmes inputs → même output', () => {
    expect(buildB2Fragment(params)).toBe(buildB2Fragment(params))
  })
})

// =============================================================================
// V2 — extractActionSnippet (Vincent 2026-05-20)
// =============================================================================

describe('B2 V2 — extractActionSnippet', () => {
  it('extrait un snippet centré sur le mot d\'action', () => {
    const s = extractActionSnippet('Procédure de nettoyage des sols quotidiennement obligatoire.')
    expect(s).toBeTruthy()
    expect(s!.toLowerCase()).toContain('nettoyage')
  })

  it('≤ 7 mots maximum (jamais une phrase longue)', () => {
    const long = 'Ceci est un long préambule administratif qui parle de la procédure de nettoyage générale du site avec beaucoup de détails inutiles.'
    const s = extractActionSnippet(long, 7)
    expect(s).toBeTruthy()
    expect(s!.split(/\s+/).length).toBeLessThanOrEqual(7)
  })

  it('null si aucun mot d\'action présent (anti faux-lien)', () => {
    const s = extractActionSnippet('Texte purement descriptif sans aucun verbe ni nom métier.')
    expect(s).toBeNull()
  })

  it('null si texte vide / null', () => {
    expect(extractActionSnippet('')).toBeNull()
    expect(extractActionSnippet(null as unknown as string)).toBeNull()
  })

  it('préserve la casse et les accents (lisibilité humaine)', () => {
    const s = extractActionSnippet('Procédure de désinfection des sols.')
    // « Procédure » ou « désinfection » doit apparaître avec ses accents
    expect(s).toMatch(/[éè]/)
  })

  it('ponctuation aux bords retirée', () => {
    const s = extractActionSnippet('Procédure : nettoyage des sols quotidiennement.')
    expect(s).not.toMatch(/^[,;:.!?…]/)
    expect(s).not.toMatch(/[,;:.!?…]$/)
  })

  it('guillemets internes retirés (re-posés par le template)', () => {
    const s = extractActionSnippet('Voir la « procédure de nettoyage » détaillée.')
    expect(s).not.toContain('«')
    expect(s).not.toContain('»')
  })

  it('aucun saut de ligne (whitespace collapsé)', () => {
    const s = extractActionSnippet('Procédure de\nnettoyage des\nsols.')
    expect(s).not.toContain('\n')
    expect(s).not.toMatch(/\s{2,}/)
  })

  it('snippet trop long (> 80 chars) → null (anti dérive)', () => {
    // Construit un mot d'action très long qui dépasserait la limite
    const longish = 'nettoyage_super_long_word_qui_depasse_largement_la_limite_imposee_pour_un_snippet_court'
    const s = extractActionSnippet(longish)
    expect(s).toBeNull()
  })

  it('exemple Vincent : « PC sécurité » dans un chunk → snippet contient l\'action', () => {
    const chunk = 'Accès par PC sécurité interdit après 18h. Nettoyage des sols quotidien.'
    const s = extractActionSnippet(chunk)
    expect(s).toBeTruthy()
    // « interdit » ou « nettoyage » devrait être présent (premier mot action)
    expect(s!.toLowerCase()).toMatch(/interdit|nettoyage/)
  })
})

describe('B2 V2 — buildB2FragmentV2', () => {
  const base = {
    docId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    docType: 'procedure',
    traceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    traceDateIso: '2026-05-19T22:00:00Z',
    snippet: 'PC sécurité',
  }

  it('format attendu : intro [doc] mentionne « snippet » — note terrain du DATE en écho [trace]', () => {
    const f = buildB2FragmentV2(base)
    expect(f).toContain('La procédure rattachée')
    expect(f).toContain(`[doc:${base.docId}]`)
    expect(f).toContain('mentionne « PC sécurité »')
    expect(f).toContain('— note terrain du')
    expect(f).toContain('en écho')
    expect(f).toContain(`[trace:${base.traceId}]`)
  })

  it('date en fuseau Nouméa (22h UTC 19 mai = 20 mai Nouméa)', () => {
    expect(buildB2FragmentV2(base)).toContain('20 mai')
  })

  it('intro selon doctype', () => {
    expect(buildB2FragmentV2({ ...base, docType: 'procedure' })).toContain('procédure rattachée')
    expect(buildB2FragmentV2({ ...base, docType: 'protocole' })).toContain('protocole rattaché')
    expect(buildB2FragmentV2({ ...base, docType: 'plan_acces' })).toContain("plan d'accès rattaché")
    expect(buildB2FragmentV2({ ...base, docType: 'securite' })).toContain('consigne de sécurité rattachée')
  })

  it('JAMAIS de mots affirmatifs prouve/démontre/confirme/certifie', () => {
    const f = buildB2FragmentV2(base).toLowerCase()
    expect(f).not.toMatch(/prouve|démontre|demontre|confirme|certifie|établit|etablit/)
  })

  it('JAMAIS de % / score / confidence', () => {
    expect(buildB2FragmentV2(base)).not.toMatch(/%|score|confidence|cosine/i)
  })

  it('« en écho » conservé (épistémologie de la plausibilité)', () => {
    expect(buildB2FragmentV2(base)).toContain('en écho')
  })
})

// =============================================================================
// Tripwires structurels sur lib/documents/cross-store-matchers.ts
// =============================================================================

describe('B2 — garde-fous structurels (cross-store-matchers.ts)', () => {
  const src = read('lib/documents/cross-store-matchers.ts')

  // Strip comments avant scan d'imports — sinon les commentaires
  // doctrinaux ("pas de server-only", "pas d'IA") mordent leur propre
  // garde-fou.
  const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('AUCUN import server-only / I/O / IA / LLM / RPC', () => {
    expect(/['"]server-only['"]/.test(codeOnly)).toBe(false)
    expect(/@\/lib\/supabase|createAdminClient|createClient/.test(codeOnly)).toBe(false)
    expect(/@anthropic-ai|@google\/genai|generateText/.test(codeOnly)).toBe(false)
    expect(/find_similar_|embedDocumentChunks|embedQuery|matchAoToKnowledge/.test(codeOnly)).toBe(false)
  })

  it('aucun service AI orchestrator/agent référencé', () => {
    expect(/services\/ai\//.test(codeOnly)).toBe(false)
  })

  it('cosine threshold figé à 0.80 (ratification §6.Q3)', () => {
    expect(/B2_COSINE_THRESHOLD\s*=\s*0\.80/.test(src)).toBe(true)
  })

  it('plafond figé à 2 (ratification §6.Q4)', () => {
    expect(/B2_MAX_PER_SITE\s*=\s*2\b/.test(src)).toBe(true)
  })

  it('algorithm_version namespacé b2_doc_trace_v2 (bump 2026-05-20 : snippet + dedup)', () => {
    expect(/B2_ALGO\s*=\s*['"]b2_doc_trace_v2['"]/.test(src)).toBe(true)
  })

  it('types juridiques absents du lexique de types acceptés', () => {
    // Heuristique : la déclaration B2_DOC_TYPES_ALLOWED ne mentionne pas
    // les types juridiques (les strings n'apparaissent pas dans la
    // partie de fichier qui définit la constante).
    const idx = src.indexOf('B2_DOC_TYPES_ALLOWED')
    const slice = src.slice(idx, idx + 400)
    for (const forbidden of ['litige', 'contrat', 'avenant', 'facture', 'memoire_technique']) {
      expect(slice.includes(forbidden), `${forbidden} ne doit pas figurer dans B2_DOC_TYPES_ALLOWED`).toBe(false)
    }
  })

  it('aucun mot affirmatif (prouve, démontre, confirme) dans le template — code only', () => {
    // Strip comments first : les commentaires doctrinaux peuvent
    // mentionner ces mots pour les INTERDIRE, sans qu'ils figurent
    // dans le code émis.
    const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/prouve|d[ée]montre|confirme|certifie|[ée]tablit/.test(stripped.toLowerCase())).toBe(false)
    // « en écho » présent → plausibilité explicite (v2 a raccourci de
    // « semble en écho » à « en écho » mais conserve l'épistémologie).
    expect(/en écho/.test(src)).toBe(true)
  })

  it('aucun internal_score / score / confidence dans tout le module', () => {
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/internal_score|confidence|cosine\s*:\s*\d|\bscore\s*[:=]/.test(codeOnly)).toBe(false)
  })

  it('étude B2 ratifiée référencée en commentaire', () => {
    expect(/ratification Vincent 2026-05-20/.test(src)).toBe(true)
  })
})
