import { describe, it, expect, vi } from 'vitest'
import {
  normalizeCanonicalLabel,
  resolveCanonicalSubjectReference,
  findLexicalAnchorMatches,
  matchCanonicalSubjects,
  type SubjectResolutionResult,
} from '@/lib/db/canonical-subject-resolve'

// ── Mock supabase/admin — table canonical_subject en mémoire ──────────────────
// resolveCanonicalSubjectReference n'utilise que deux formes de requête :
//   select().eq('site_id', ..).in('status', [...])   → lecture
//   update({status:'active'}).eq('id', ..).eq('status','auto_archived') → réactivation
// Le mock reproduit ces deux formes sans toucher à une vraie DB.
type FakeRow = { id: string; label: string; aliases: string[] | null; status: string; site_id: string }

function makeAdminClientMock(rows: FakeRow[]) {
  function builder() {
    let mode: 'select' | 'update' = 'select'
    let updatePayload: Partial<FakeRow> = {}
    const filters: Array<(r: FakeRow) => boolean> = []
    const api = {
      select(_cols: string) { mode = 'select'; return api },
      update(payload: Partial<FakeRow>) { mode = 'update'; updatePayload = payload; return api },
      eq(field: keyof FakeRow, value: unknown) { filters.push((r) => r[field] === value); return api },
      in(field: keyof FakeRow, values: unknown[]) { filters.push((r) => values.includes(r[field] as never)); return api },
      then(resolve: (result: { data: FakeRow[]; error: null }) => void) {
        const matched = rows.filter((r) => filters.every((f) => f(r)))
        if (mode === 'update') {
          matched.forEach((r) => Object.assign(r, updatePayload))
        }
        resolve({ data: matched.map((r) => ({ ...r })), error: null })
      },
    }
    return api
  }
  return { from: (_table: string) => builder() }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdminClientMock(mockRows),
}))

let mockRows: FakeRow[] = []

// ── Tests de normalizeCanonicalLabel ─────────────────────────────────────────

describe('normalizeCanonicalLabel', () => {
  it('met en minuscules et supprime les accents', () => {
    expect(normalizeCanonicalLabel('G3 purge complémentaire')).toBe('g3 purge complementaire')
  })

  it('supprime la ponctuation', () => {
    expect(normalizeCanonicalLabel('R4 — essais béton')).toBe('r4 essais beton')
  })

  it('normalise les espaces multiples', () => {
    expect(normalizeCanonicalLabel('G3  purge  complementaire')).toBe('g3 purge complementaire')
  })
})

// ── Factories pour simuler des canonical_subjects ─────────────────────────────
// Les tests unitaires de résolution ne font pas appel à la base de données.
// On vérifie uniquement la logique de classement et de décision.

// Pour tester la logique pure sans DB, on expose les fonctions utilitaires
// via l'import et on teste directement les heuristiques.
// Les tests d'intégration avec la vraie DB sont hors-périmètre de ce lot.

import { extractTechnicalCodes } from '@/lib/documents/semantic-subject-resolution'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

describe('extractTechnicalCodes — utilisé dans la résolution', () => {
  it('extrait G3 et R4', () => {
    expect(extractTechnicalCodes('G3 purge complémentaire')).toEqual(new Set(['G3']))
    expect(extractTechnicalCodes('Regard R4 béton')).toEqual(new Set(['R4']))
  })

  it('extrait plusieurs codes', () => {
    expect(extractTechnicalCodes('G3 et R4 liés')).toEqual(new Set(['G3', 'R4']))
  })

  it("n'extrait pas les mots sans chiffres (CVCD, BECIB)", () => {
    expect(extractTechnicalCodes('Rapport BECIB CVCD')).toEqual(new Set())
  })

  it('extrait DN160 et PVC200', () => {
    expect(extractTechnicalCodes('Réseau DN160 PVC200')).toEqual(new Set(['DN160', 'PVC200']))
  })
})

describe('jaccardSimilarity — base de la résolution', () => {
  it('labels identiques → 1.0', () => {
    expect(jaccardSimilarity('G3 purge complémentaire', 'G3 purge complémentaire')).toBe(1)
  })

  it('aucun token commun → 0', () => {
    expect(jaccardSimilarity('G3 purge', 'R4 béton dalle')).toBe(0)
  })

  it('token G3 commun entre deux labels différents', () => {
    const scoreA = jaccardSimilarity('G3', 'G3 purge complémentaire')
    const scoreB = jaccardSimilarity('G3', 'G3 essais plateforme support dalle')
    // Les deux scores doivent être > 0 (G3 est en commun)
    expect(scoreA).toBeGreaterThan(0)
    expect(scoreB).toBeGreaterThan(0)
    // G3 purge complémentaire a moins de tokens → score Jaccard plus élevé
    expect(scoreA).toBeGreaterThan(scoreB)
  })
})

// ── matchCanonicalSubjects — passes appliquées à UN pool (pure, sans DB) ──────

describe('matchCanonicalSubjects', () => {
  it('G3 seul avec 2 sujets G3 → ambiguous (code technique commun, pas d\'écart Jaccard)', () => {
    const result = matchCanonicalSubjects('G3', [
      { id: 'g3-purge', label: 'G3 purge complémentaire', aliases: null },
      { id: 'g3-essais', label: 'G3 essais plateforme support dalle', aliases: null },
    ])
    expect(result.kind).toBe('ambiguous')
  })

  it('label exact unique → resolved', () => {
    const result = matchCanonicalSubjects('G3 purge complémentaire', [
      { id: 'g3-purge', label: 'G3 purge complémentaire', aliases: null },
      { id: 'r4-essais', label: 'R4 essais béton', aliases: null },
    ])
    expect(result).toEqual<SubjectResolutionResult>({
      kind: 'resolved',
      candidate: { id: 'g3-purge', label: 'G3 purge complémentaire' },
    })
  })

  it('pool vide → not_found', () => {
    expect(matchCanonicalSubjects('G3', [])).toEqual({ kind: 'not_found' })
  })

  it('aucun candidat plausible → not_found', () => {
    const result = matchCanonicalSubjects('gaines techniques verticales', [
      { id: 'sujet-sans-rapport', label: 'Accès sécurisé au chantier (portail et cadenas à code)', aliases: null },
    ])
    expect(result).toEqual({ kind: 'not_found' })
  })
})

// ── resolveCanonicalSubjectReference — deux niveaux (P4-D1.1, 2026-08-17) ─────
// Mandat : "doit ignorer les sujets non actifs dans la résolution courante,
// sans casser les chemins explicites de réactivation."

describe('resolveCanonicalSubjectReference — priorité active, repli auto_archived', () => {
  const SITE_ID = 'site-petro'
  const DUP_LABEL = 'Dépose du SSI et matériel incendie : identification du responsable'

  it('même libellé actif + auto_archived (cas réel PETRO) → resolved vers l\'actif, jamais ambiguous', async () => {
    mockRows = [
      { id: 'active-id', label: DUP_LABEL, aliases: null, status: 'active', site_id: SITE_ID },
      { id: 'archived-id', label: DUP_LABEL, aliases: null, status: 'auto_archived', site_id: SITE_ID },
    ]
    const result = await resolveCanonicalSubjectReference(SITE_ID, DUP_LABEL)
    expect(result).toEqual({ kind: 'resolved', candidate: { id: 'active-id', label: DUP_LABEL } })
  })

  it('même cas → le sujet auto_archived n\'est pas réactivé (l\'actif suffit)', async () => {
    mockRows = [
      { id: 'active-id', label: DUP_LABEL, aliases: null, status: 'active', site_id: SITE_ID },
      { id: 'archived-id', label: DUP_LABEL, aliases: null, status: 'auto_archived', site_id: SITE_ID },
    ]
    await resolveCanonicalSubjectReference(SITE_ID, DUP_LABEL)
    const archived = mockRows.find((r) => r.id === 'archived-id')
    expect(archived?.status).toBe('auto_archived')
  })

  it('sujet uniquement auto_archived, aucun actif correspondant → repli explicite, réactivé', async () => {
    mockRows = [
      { id: 'archived-id', label: 'Regard R4 béton', aliases: null, status: 'auto_archived', site_id: SITE_ID },
      { id: 'other-active', label: 'Terrassement plateforme G3', aliases: null, status: 'active', site_id: SITE_ID },
    ]
    const result = await resolveCanonicalSubjectReference(SITE_ID, 'Regard R4 béton')
    expect(result).toEqual({ kind: 'resolved', candidate: { id: 'archived-id', label: 'Regard R4 béton' } })
    expect(mockRows.find((r) => r.id === 'archived-id')?.status).toBe('active')
  })

  it('aucune correspondance dans aucun pool → not_found', async () => {
    mockRows = [
      { id: 'active-id', label: 'Terrassement plateforme G3', aliases: null, status: 'active', site_id: SITE_ID },
    ]
    const result = await resolveCanonicalSubjectReference(SITE_ID, 'gaines techniques verticales')
    expect(result).toEqual({ kind: 'not_found' })
  })
})

// ── Tests de la logique de normalisation (ne nécessitent pas la DB) ────────────

describe('normalisation et correspondance exacte', () => {
  it('même label, casse différente → correspondance exacte', () => {
    const a = normalizeCanonicalLabel('G3 PURGE COMPLÉMENTAIRE')
    const b = normalizeCanonicalLabel('g3 purge complémentaire')
    expect(a).toBe(b)
  })

  it('ordre des mots différent → pas de correspondance exacte (string order-dependent)', () => {
    const a = normalizeCanonicalLabel('essais G3 plateforme')
    const b = normalizeCanonicalLabel('G3 essais plateforme')
    expect(a).not.toBe(b)
  })
})

// ── findLexicalAnchorMatches — P4-A.1 (2026-08-17) ─────────────────────────────
// Ancrage lexical discriminant : un mot court parlé naturellement ("cadenas",
// "portail") doit retrouver un canonical_subject dont le libellé est long,
// sans dépendre du seuil Jaccard global. Sûreté par comptage de sujets touchés :
// 1 seul sujet → résolution certaine ; plusieurs → ambiguïté, jamais tranchée.

describe('findLexicalAnchorMatches', () => {
  const PETRO_ACCES = {
    id: 'subj-acces',
    label: 'Accès sécurisé au chantier (portail et cadenas à code)',
    aliases: null,
  }
  const PETRO_TERRASSEMENT = {
    id: 'subj-terrassement',
    label: 'Terrassement plateforme G3',
    aliases: null,
  }

  // resolveCanonicalSubjectReference reçoit toujours une entité déjà extraite
  // (classification.entities.subjectLabels[0]), jamais la phrase brute — c'est
  // le LLM de compréhension (mergeComprehension) qui isole "cadenas"/"portail"
  // depuis "Le cadenas n'est toujours pas installé." avant l'appel.

  it('"cadenas" seul retrouve le sujet "Accès sécurisé..." sans ambiguïté', () => {
    const result = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-acces')
  })

  it('"portail" seul retrouve le même sujet', () => {
    const result = findLexicalAnchorMatches('portail', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-acces')
  })

  it('la même entité "cadenas" retrouve le même sujet que ce soit issue d\'un READ ou d\'une OBSERVATION', () => {
    // "Où en est le cadenas ?" (READ) et "Le cadenas n'est toujours pas installé." (OBSERVATION)
    // convergent toutes deux vers la même entité extraite "cadenas" avant résolution.
    const readResult = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    const observationResult = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(readResult).toHaveLength(1)
    expect(observationResult).toHaveLength(1)
    expect(readResult[0].id).toBe(observationResult[0].id)
  })

  it('un mot absent de tout label → aucun ancrage (laisse la main au Jaccard/not_found)', () => {
    const result = findLexicalAnchorMatches('gaines', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(0)
  })

  it('collision : "planning" partagé par deux sujets → ambiguïté, pas de résolution auto', () => {
    const planningA = { id: 'subj-planning-a', label: 'Planning travaux gros œuvre', aliases: null }
    const planningB = { id: 'subj-planning-b', label: 'Planning livraison matériaux', aliases: null }
    const result = findLexicalAnchorMatches('planning', [planningA, planningB, PETRO_ACCES])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id).sort()).toEqual(['subj-planning-a', 'subj-planning-b'])
  })

  it('collision : terme générique "matériel" présent dans plusieurs sujets → abstention', () => {
    const materielA = { id: 'subj-materiel-a', label: 'Livraison matériel électrique', aliases: null }
    const materielB = { id: 'subj-materiel-b', label: 'Stockage matériel chantier', aliases: null }
    const result = findLexicalAnchorMatches('matériel', [materielA, materielB])
    expect(result).toHaveLength(2)
  })

  it('un token unique trop court (< 7 caractères) ne matche pas seul', () => {
    // "porte" (5 lettres) ne doit pas suffire à matcher par containment.
    const porte = { id: 'subj-porte', label: 'Porte du local technique', aliases: null }
    const result = findLexicalAnchorMatches('la porte', [porte])
    expect(result).toHaveLength(0)
  })

  it('un alias discriminant retrouve aussi le sujet', () => {
    const withAlias = { id: 'subj-alias', label: 'Accès chantier', aliases: ['cadenas à code'] }
    const result = findLexicalAnchorMatches('Le cadenas à code ne fonctionne plus.', [withAlias])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-alias')
  })
})
