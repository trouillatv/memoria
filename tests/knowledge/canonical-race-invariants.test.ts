import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decideReconcileLock,
  RECONCILE_LOCK_TTL_MS,
  isUniqueLabelViolation,
  matchInheritedProposals,
  findActiveSubjectByNormalizedLabel,
  resolveMatchExistingDecision,
  clusterByJaccard,
  CAN_CREATE_SUBJECT_KINDS,
} from '@/lib/db/canonical-subject-source-reconcile'
import { ELIGIBLE_KINDS } from '@/lib/db/canonical-subject-reconcile'
import { normalizeCanonicalLabel } from '@/lib/db/canonical-subject-resolve'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

// ─────────────────────────────────────────────────────────────────────────────
// P0-9 — verrouillage par tests des invariants du pipeline canonique.
//
// Ces tests figent les règles qui ont manqué lors de l'incident du 14/08 :
// deux runs concurrents ont matérialisé deux fois les mêmes sujets, des acteurs
// ont été promus en sujets, et un rejeu a créé un monde parallèle.
//
// Ils ne décrivent PAS le comportement observé à l'époque : ils décrivent le
// comportement corrigé. Un test qui échoue ici = une régression vers le bug.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_RECONCILE = readFileSync(
  join(process.cwd(), 'lib/db/canonical-subject-source-reconcile.ts'), 'utf8',
)
const SRC_INTERVENANTS = readFileSync(
  join(process.cwd(), 'lib/db/site-intervenants.ts'), 'utf8',
)
const SRC_INTERVENANTS_ACTIONS = readFileSync(
  join(process.cwd(), 'app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions.ts'), 'utf8',
)
const SRC_MIG_323 = readFileSync(
  join(process.cwd(), 'supabase/migrations/323_canonical_reconcile_lock.sql'), 'utf8',
)

// ─── Cas 1-3 : doctrine acteur ≠ sujet ───────────────────────────────────────
// « Un acteur est une identité/intervenant. Un sujet canonique est une question,
//   situation, décision, problème ou thème métier durable du chantier. »
// Le seul garde-fou structurel est le filtre de kind : une proposition d'acteur
// porte kind 'contact' ou 'company', jamais un kind éligible.

describe('doctrine acteur ≠ sujet canonique', () => {
  it("entreprise seule → 'company' n'est pas un kind éligible, aucun sujet possible", () => {
    expect(ELIGIBLE_KINDS.has('company')).toBe(false)
    expect(CAN_CREATE_SUBJECT_KINDS.has('company')).toBe(false)
  })

  it("personne seule → 'contact' n'est pas un kind éligible, aucun sujet possible", () => {
    expect(ELIGIBLE_KINDS.has('contact')).toBe(false)
    expect(CAN_CREATE_SUBJECT_KINDS.has('contact')).toBe(false)
  })

  it('acteur + sujet dans la même phrase → seul le fait métier traverse le filtre', () => {
    // « L'électricien Dupont (ETV) doit reprendre les consignations du R4 »
    // projeté en deux propositions distinctes.
    const projected = [
      { kind: 'company', title: 'ETV' },
      { kind: 'contact', title: 'Dupont' },
      { kind: 'vigilance', title: 'Reprise des consignations électriques R4' },
    ]
    const eligible = projected.filter((p) => ELIGIBLE_KINDS.has(p.kind))
    expect(eligible).toHaveLength(1)
    expect(eligible[0].title).toBe('Reprise des consignations électriques R4')
  })

  it('le filtre de kind est bien la porte d’entrée unique du pipeline', () => {
    expect(SRC_RECONCILE).toMatch(/proposals\.filter\(\(p\) => ELIGIBLE_KINDS\.has\(p\.kind\)\)/)
  })
})

// ─── Cas 9 : ensureActorCanonicalSubject retiré du chemin intervenant ────────
// P0-6. Ces modules sont `server-only` (DB) → invariant protégé par lecture de
// source, même pattern que action-fiche.doctrine.

describe('P0-6 — confirmer un acteur ne crée plus de sujet canonique', () => {
  it('site-intervenants n’appelle plus ensureActorCanonicalSubject', () => {
    expect(SRC_INTERVENANTS).not.toMatch(/^\s*await ensureActorCanonicalSubject\(/m)
    expect(SRC_INTERVENANTS).not.toMatch(/import .*ensureActorCanonicalSubject/)
  })

  it('l’action serveur intervenants ne l’appelle plus non plus', () => {
    expect(SRC_INTERVENANTS_ACTIONS).not.toContain('ensureActorCanonicalSubject')
  })

  it("aucun creation_source 'actor_link' ne peut plus être produit par la réconciliation", () => {
    expect(SRC_RECONCILE).not.toContain('actor_link')
  })
})

// ─── Cas 4 : reformulation sous le seuil Jaccard ─────────────────────────────
// Correction explicite de Vincent : ce test ne doit PAS affirmer qu'un nouveau
// sujet distinct est créé — ce serait figer le bug. Il doit prouver que la
// reformulation échappe bien au clustering lexical PUIS que MATCH_EXISTING
// (Phase 1.5, P0-4) la rattache au sujet existant.

describe('reformulation sous le seuil Jaccard — MATCH_EXISTING rattache', () => {
  const EXISTANT = 'Reprise des consignations électriques R4'
  const REFORMULE = 'Consignation à refaire niveau 4 par l’électricien'

  it('la similarité lexicale est sous le seuil de clustering (le bug de départ)', () => {
    const score = jaccardSimilarity(EXISTANT, REFORMULE)
    expect(score).toBeLessThan(0.35)
  })

  it('le clustering lexical seul les sépare — il ne peut donc pas suffire', () => {
    const clusters = clusterByJaccard([EXISTANT, REFORMULE], 0.28)
    expect(clusters).toHaveLength(2)
  })

  it('MATCH_EXISTING rattache au sujet existant : aucun nouveau canonical_subject', () => {
    const existing = [{ id: '4f3a1c2e-0000-4000-8000-000000000001', label: EXISTANT }]
    const gemini = { canonicalSubjectId: existing[0].id, confidence: 0.93 }
    expect(resolveMatchExistingDecision(gemini, existing)).toBe('attach')
  })

  it('MATCH_EXISTING passe AVANT le clustering et la création (P0-4)', () => {
    const iMatch = SRC_RECONCILE.indexOf('Phase 1.5')
    const iCreate = SRC_RECONCILE.indexOf('Phase 2a')
    expect(iMatch).toBeGreaterThan(-1)
    expect(iCreate).toBeGreaterThan(iMatch)
  })
})

// ─── Cas 5 + 10 : même label exact, conflit d'unicité absorbé ────────────────

describe('P0-3 — conflit d’unicité (mig 323) absorbé, jamais orphelin', () => {
  it('23505 est la seule erreur qui autorise une reprise', () => {
    expect(isUniqueLabelViolation({ code: '23505' })).toBe(true)
    expect(isUniqueLabelViolation({ code: '23503' })).toBe(false)
    expect(isUniqueLabelViolation({ code: null })).toBe(false)
    expect(isUniqueLabelViolation(null)).toBe(false)
  })

  it('la reprise retrouve le gagnant malgré casse, accents et ponctuation', async () => {
    const sb = fakeSubjectsClient([
      { id: 'cs-gagnant', label: 'Sécurité & stockage des bouteilles' },
      { id: 'cs-autre', label: 'Réseau eau chaude' },
    ])
    const found = await findActiveSubjectByNormalizedLabel(
      sb, 'site-x', 'SECURITE   ET stockage des bouteilles',
    )
    // « et » n'est pas « & » : la normalisation ne fait pas de synonymie.
    expect(found).toBeNull()

    const exact = await findActiveSubjectByNormalizedLabel(
      sb, 'site-x', 'securite   &&&  STOCKAGE des bouteilles',
    )
    expect(exact).toBe('cs-gagnant')
  })

  it('la reprise ne retourne rien si aucun sujet actif ne correspond', async () => {
    const sb = fakeSubjectsClient([{ id: 'cs-autre', label: 'Réseau eau chaude' }])
    expect(await findActiveSubjectByNormalizedLabel(sb, 'site-x', 'Toiture R4')).toBeNull()
  })

  it('le perdant de la course se rattache au gagnant au lieu d’orpheliner ses faits', () => {
    // Sans cette reprise, l'index 323 remplacerait « deux jumeaux actifs » par
    // « faits détachés du graphe » — plus silencieux, donc pire.
    expect(SRC_RECONCILE).toMatch(
      /isUniqueLabelViolation\(csErr\)\s*\?\s*await findActiveSubjectByNormalizedLabel/,
    )
    expect(SRC_RECONCILE).toMatch(/if \(!recovered\) \{[\s\S]{0,300}result\.orphaned \+= groupProposals\.length/)
  })

  it('un sujet récupéré ne recrée pas d’identité de thread (STI orpheline)', () => {
    expect(SRC_RECONCILE).toMatch(/if \(createdNow\) \{[\s\S]{0,200}subject_thread_identity/)
    expect(SRC_RECONCILE).toMatch(/createdNow \? sharedThreadId : undefined/)
  })
})

describe('index 323 — deux créations exactes ne peuvent laisser deux sujets actifs', () => {
  it('l’index est unique, partiel sur status active, et scopé au site', () => {
    expect(SRC_MIG_323).toMatch(/CREATE UNIQUE INDEX[\s\S]*canonical_subject_active_normalized_label_uniq/)
    expect(SRC_MIG_323).toMatch(/ON public\.canonical_subject \(site_id, public\.canonical_normalize_label\(label\)\)/)
    expect(SRC_MIG_323).toMatch(/WHERE status = 'active'/)
  })

  it('NFD est un mot-clé SQL, jamais une chaîne (sinon la migration ne compile pas)', () => {
    expect(SRC_MIG_323).toContain('normalize(label, NFD)')
    expect(SRC_MIG_323).not.toContain("normalize(label, 'NFD')")
  })

  it('la fonction SQL est IMMUTABLE STRICT (condition d’un index fonctionnel)', () => {
    expect(SRC_MIG_323).toMatch(/LANGUAGE sql IMMUTABLE STRICT/)
  })

  it('la normalisation TS et la normalisation SQL décrivent les mêmes étapes', () => {
    // Parité de règles, vérifiable hors base : minuscule, NFD, retrait des
    // diacritiques combinants, non-alphanum → espace, collapse, trim.
    expect(SRC_MIG_323).toContain('lower(')
    expect(SRC_MIG_323).toContain('[\\x{0300}-\\x{036F}]+')
    expect(SRC_MIG_323).toContain('[^a-z0-9[:space:]]')
    expect(SRC_MIG_323).toMatch(/'\\s\+', ' ', 'g'/)
    expect(SRC_MIG_323).toContain('trim(')

    expect(normalizeCanonicalLabel('Sécurité & Stockage')).toBe('securite stockage')
    expect(normalizeCanonicalLabel('  ÉTANCHÉITÉ  toiture-R4 ')).toBe('etancheite toiture r4')
  })
})

// ─── Cas 6 : rapport rejoué, héritage Phase 0 ────────────────────────────────

describe('P0-5 — un rejeu hérite du canonical_subject, pas un monde parallèle', () => {
  const CS = 'cs-toiture-0001'

  it('une proposition rejouée quasi identique hérite du sujet de la supersédée', () => {
    const pairs = matchInheritedProposals(
      [{ id: 'old-1', title: 'Étanchéité toiture terrasse R4', canonical_subject_id: CS }],
      [{ id: 'new-1', title: 'Étanchéité toiture terrasse R4 à reprendre' }],
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ staleId: 'old-1', eligibleId: 'new-1', canonicalSubjectId: CS })
  })

  it('une éligible ne peut hériter que d’une seule supersédée', () => {
    const pairs = matchInheritedProposals(
      [
        { id: 'old-1', title: 'Étanchéité toiture terrasse R4', canonical_subject_id: 'cs-a' },
        { id: 'old-2', title: 'Étanchéité toiture terrasse R4', canonical_subject_id: 'cs-b' },
      ],
      [{ id: 'new-1', title: 'Étanchéité toiture terrasse R4' }],
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0].eligibleId).toBe('new-1')
  })

  it('sous le seuil d’héritage, aucun ID n’est transmis (l’identité ne se devine pas)', () => {
    const pairs = matchInheritedProposals(
      [{ id: 'old-1', title: 'Étanchéité toiture terrasse R4', canonical_subject_id: CS }],
      [{ id: 'new-1', title: 'Réseau eau chaude sous-sol' }],
    )
    expect(pairs).toEqual([])
  })

  it('le seuil d’héritage est plus strict que le seuil de proximité', () => {
    // Hériter un ID est une décision d'identité, pas une suggestion de proximité.
    const stale = { id: 'old-1', title: 'toiture pluie neige orage', canonical_subject_id: CS }
    const fresh = { id: 'new-1', title: 'toiture pluie facade sol' }
    // Jaccard = 2/6 ≈ 0.333 : au-dessus du seuil de proximité (0.28) mais
    // sous le seuil d'héritage (0.50).
    expect(jaccardSimilarity(stale.title, fresh.title)).toBeCloseTo(0.333, 2)
    expect(matchInheritedProposals([stale], [fresh], 0.50)).toEqual([])
    expect(matchInheritedProposals([stale], [fresh], 0.28)).toHaveLength(1)
  })

  it('Phase 0 consomme le helper testé — une seule règle, pas deux', () => {
    expect(SRC_RECONCILE).toMatch(/const pairs = matchInheritedProposals\(/)
  })
})

// ─── Cas 7 : deux runs concurrents ───────────────────────────────────────────

describe('P0-2 — un seul run acquiert le verrou', () => {
  const T0 = Date.parse('2026-08-15T10:00:00.000Z')

  it('rapport déjà réconcilié → aucun second run (idempotence)', () => {
    expect(decideReconcileLock({ canonical_reconciled_at: '2026-08-15T09:00:00Z' }, T0)).toBe('done')
  })

  it('verrou récent → le second run abandonne, il ne matérialise rien en parallèle', () => {
    const started = new Date(T0 - 30_000).toISOString()
    expect(decideReconcileLock({ canonical_reconcile_started_at: started }, T0)).toBe('concurrent')
  })

  it('aucun verrou → le run tente l’acquisition', () => {
    expect(decideReconcileLock({}, T0)).toBe('acquire')
    expect(decideReconcileLock(null, T0)).toBe('acquire')
  })

  it('verrou expiré (> TTL) → un run bloqué ne gèle pas le rapport à vie', () => {
    const started = new Date(T0 - RECONCILE_LOCK_TTL_MS - 1).toISOString()
    expect(decideReconcileLock({ canonical_reconcile_started_at: started }, T0)).toBe('acquire')
  })

  it('réconcilié gagne sur verrou présent (un run tardif ne rejoue jamais)', () => {
    expect(decideReconcileLock({
      canonical_reconciled_at: '2026-08-15T09:00:00Z',
      canonical_reconcile_started_at: new Date(T0 - 1000).toISOString(),
    }, T0)).toBe('done')
  })

  it("'acquire' n’est qu’une autorisation : le CAS SQL reste l’arbitre final", () => {
    expect(SRC_RECONCILE).toContain('canonical_reconcile_started_at')
    const src = readFileSync(join(process.cwd(), 'lib/visits/debrief-analysis.ts'), 'utf8')
    expect(src).toContain('decideReconcileLock')
    // Compare-and-swap : la mise à jour n'aboutit que si le verrou est libre.
    expect(src).toMatch(/\.is\('canonical_reconcile_started_at', null\)/)
    // Le verrou est toujours relâché, y compris en erreur.
    expect(src).toMatch(/canonical_reconcile_started_at: null/)
  })
})

// ─── Cas 8 : invariant Fact Ledger ───────────────────────────────────────────
// « toute proposition portant canonical_subject_id possède une occurrence sur
//   ce même canonical ». Structurellement : l'upsert d'occurrence précède
//   toujours l'UPDATE de la proposition, dans chaque phase d'écriture.

describe('invariant Fact Ledger — occurrence avant pointeur de proposition', () => {
  const writes = [...SRC_RECONCILE.matchAll(
    /\.from\('(canonical_subject_occurrence|site_knowledge_proposals)'\)\s*\n?\s*\.(upsert|update)\(/g,
  )]

  it('le module écrit bien dans les deux tables (garde-fou du test lui-même)', () => {
    expect(writes.some((m) => m[1] === 'canonical_subject_occurrence')).toBe(true)
    expect(writes.some((m) => m[1] === 'site_knowledge_proposals')).toBe(true)
  })

  it('chaque pose de canonical_subject_id est précédée d’un upsert d’occurrence', () => {
    // On isole les blocs qui posent le pointeur et on vérifie qu'un upsert
    // d'occurrence sur le MÊME canonicalSubjectId le précède dans la source.
    const pointerIdxs = [...SRC_RECONCILE.matchAll(/canonical_subject_id: canonicalSubjectId,\s+canonical_resolution_status/g)]
      .map((m) => m.index ?? -1)
    expect(pointerIdxs.length).toBeGreaterThanOrEqual(2) // Phase 2a + Phase 2b

    const occUpsertIdxs = [...SRC_RECONCILE.matchAll(
      /from\('canonical_subject_occurrence'\)\s*\.upsert\(\s*\{\s*canonical_subject_id: canonicalSubjectId,/g,
    )].map((m) => m.index ?? -1)
    expect(occUpsertIdxs.length).toBeGreaterThanOrEqual(2)

    for (const idx of pointerIdxs) {
      // L'upsert doit précéder le pointeur ET appartenir au même bloc
      // (proximité) — pas à une phase antérieure sans rapport.
      const paired = occUpsertIdxs.some((o) => o < idx && idx - o < 2000)
      expect(paired).toBe(true)
    }
  })

  it('l’occurrence est idempotente (rejeu sans doublon)', () => {
    expect(SRC_RECONCILE).toMatch(/onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true/)
  })
})

// ─── Régression générique (pattern retrouvé sur OCEF, pas seulement PETRO) ───
// Le même pattern de coquilles de course existait sur « OCEF — Recette Chemin B »
// (8 paires actives, 0 occurrence, 0 proposition). Le correctif doit être
// prouvé générique : aucune règle ne connaît un chantier particulier.

describe('régression générique — le correctif n’est lié à aucun chantier', () => {
  it('aucun identifiant de chantier n’est codé en dur dans le moteur', () => {
    const uuids = SRC_RECONCILE.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []
    expect(uuids).toEqual([])
  })

  it('la reprise sur conflit est scopée au site du run, jamais à un site fixe', () => {
    expect(SRC_RECONCILE).toMatch(/findActiveSubjectByNormalizedLabel\(sb, source\.siteId,/)
    expect(SRC_RECONCILE).toMatch(/\.eq\('site_id', siteId\)/)
  })

  it('le verrou et l’héritage sont des fonctions pures, sans dépendance au site', () => {
    // Si ces règles dépendaient du chantier, le nettoyage OCEF aurait exigé un
    // second correctif — c'est précisément ce qu'on refuse.
    expect(decideReconcileLock({}, 0)).toBe('acquire')
    expect(matchInheritedProposals([], [{ id: 'x', title: 'y' }])).toEqual([])
  })

  it('deux coquilles vides de même label normalisé sont désormais impossibles (OCEF)', () => {
    // Les 8 paires OCEF différaient seulement par la casse et la ponctuation.
    const paire = ['OCEF — Recette Chemin B', 'ocef - recette chemin b']
    expect(normalizeCanonicalLabel(paire[0])).toBe(normalizeCanonicalLabel(paire[1]))
    // → même clé d'index unique → la seconde création échoue en 23505
    //   → et se rattache à la première au lieu de créer un jumeau.
  })
})

// ─── Fake client minimal ─────────────────────────────────────────────────────
// findActiveSubjectByNormalizedLabel n'utilise que .from().select().eq().eq().

function fakeSubjectsClient(rows: Array<{ id: string; label: string }>): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: { data: typeof rows }) => unknown) => resolve({ data: rows }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}
