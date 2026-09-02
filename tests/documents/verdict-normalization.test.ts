import { describe, it, expect } from 'vitest'
import { normalizeDocumentVerdict, type VerdictContext } from '@/lib/documents/verdict-normalization'

// Lot E1 — capture & séparation des axes du verdict documentaire.
// Le corpus RÉEL (audit E) mêlait conformité, cycle de vie, présence, rôle,
// thématique et temporel dans un seul champ. On vérifie ici que :
//   · le brut est conservé SANS PERTE ;
//   · les vocabulaires connus sont classés par axe (conformité vs cycle de vie) ;
//   · « non vérifié / non applicable » ne deviennent JAMAIS une preuve positive ;
//   · présence / rôle / thématique sont RECONNUS mais NON interprétés (hors E) ;
//   · l'inconnu et les codes ambigus restent conservés, jamais forcés.
// Aucune projection vers state_status (E2) n'est testée ici.

const kf: VerdictContext = { family: 'knowledge_fact', thematicCategory: 'test_control' }
const res: VerdictContext = { family: 'reservation', thematicCategory: 'progress' }

describe('E1 — conservation LOSSLESS du brut', () => {
  it('conserve la casse et le texte exact quel que soit le classement', () => {
    expect(normalizeDocumentVerdict('Non Vérifié', kf).raw).toBe('Non Vérifié')
    expect(normalizeDocumentVerdict('  Conforme  ', kf).raw).toBe('Conforme')
    expect(normalizeDocumentVerdict('bidule inconnu', kf).raw).toBe('bidule inconnu')
  })
})

describe('E1 — axe conformité (corpus CAPSE + audit)', () => {
  it('conforme / favorable / validé / OK / RAS → compliant_positive', () => {
    for (const v of ['Conforme', 'C - Conforme', 'favorable', 'validé', 'OK', 'RAS', 'Satisfaisant']) {
      const r = normalizeDocumentVerdict(v, kf)
      expect(r.axis).toBe('compliance')
      expect(r.normalized).toBe('compliant_positive')
    }
  })
  it('non conforme / NOK / refusé / insatisfaisant → compliant_negative (jamais positif)', () => {
    for (const v of ['Non conforme', 'NC - Non conforme', 'NOK', 'Refusé', 'Insatisfaisant', 'défavorable']) {
      const r = normalizeDocumentVerdict(v, kf)
      expect(r.axis).toBe('compliance')
      expect(r.normalized).toBe('compliant_negative')
    }
  })
  it('non vérifié / non examiné / non contrôlé / non testé → unverified (PAS resolved)', () => {
    for (const v of ['Non vérifié', 'Non Vérifié', 'non examiné', 'Non contrôlé', 'non testé']) {
      const r = normalizeDocumentVerdict(v, kf)
      expect(r.axis).toBe('compliance')
      expect(r.normalized).toBe('unverified')
    }
  })
  it('non applicable / N/A / sans objet → not_applicable', () => {
    for (const v of ['Non applicable', 'N/A', 'NA', 'sans objet', 'hors périmètre']) {
      expect(normalizeDocumentVerdict(v, kf).normalized).toBe('not_applicable')
    }
  })
  it('à vérifier / à contrôler / visa en cours / en attente → pending_control', () => {
    for (const v of ['À vérifier', 'à contrôler', 'visa en cours', 'en attente', 'à confirmer']) {
      expect(normalizeDocumentVerdict(v, kf).normalized).toBe('pending_control')
    }
  })
})

describe('E1 — axe cycle de vie distinct de la conformité', () => {
  it('réalisé / fait / levé / corrigé / mis en place / 100% → lifecycle_done', () => {
    for (const v of ['réalisé', 'Fait', 'levée', 'corrigé', 'mis en place', '100%', 'terminé', 'émis']) {
      const r = normalizeDocumentVerdict(v, res)
      expect(r.axis).toBe('lifecycle')
      expect(r.normalized).toBe('lifecycle_done')
    }
  })
  it('en cours / partiel / démarré → lifecycle_in_progress', () => {
    for (const v of ['en cours', 'partiellement réalisé', 'démarré']) {
      expect(normalizeDocumentVerdict(v, res).normalized).toBe('lifecycle_in_progress')
    }
  })
  it('non démarré / à faire / prévu / planifié → lifecycle_planned', () => {
    for (const v of ['non démarré', 'à faire', 'prévu', 'planifié']) {
      expect(normalizeDocumentVerdict(v, res).normalized).toBe('lifecycle_planned')
    }
  })
  it('ouvert / signalé / à corriger / non réalisé → lifecycle_open', () => {
    for (const v of ['ouvert', 'ouverte', 'signalé', 'à corriger', 'non réalisé']) {
      expect(normalizeDocumentVerdict(v, res).normalized).toBe('lifecycle_open')
    }
  })
  it('« conforme » (compliance) et « réalisé » (lifecycle) ne sont PAS le même axe', () => {
    expect(normalizeDocumentVerdict('conforme', kf).axis).toBe('compliance')
    expect(normalizeDocumentVerdict('réalisé', kf).axis).toBe('lifecycle')
  })
})

describe('E1 — frontière E/F : présence & rôle reconnus mais NON interprétés', () => {
  it('présent / absent / diffusion (family person) → axe presence, normalized null', () => {
    for (const v of ['présent', 'absent', 'absent excusé', 'diffusion uniquement', 'invité', 'inconnu']) {
      const r = normalizeDocumentVerdict(v, { family: 'person' })
      expect(r.axis).toBe('presence')
      expect(r.normalized).toBeNull()
      expect(r.raw).toBe(v) // conservé
    }
  })
  it("rôles organisationnels (family company) → axe org_role, normalized null", () => {
    for (const v of ["maître d'œuvre", 'AMO', 'entreprise titulaire', 'sous-traitant']) {
      const r = normalizeDocumentVerdict(v, { family: 'company' })
      expect(r.axis).toBe('org_role')
      expect(r.normalized).toBeNull()
    }
  })
  it('un « présent » sur une famille NON-personne n\'est pas capté comme conformité', () => {
    // sécurité : même si le mot fuyait ailleurs, il ne devient pas un verdict positif
    const r = normalizeDocumentVerdict('présent', kf)
    expect(r.normalized).not.toBe('compliant_positive')
  })
})

describe('E1 — inconnu / ambigu / thématique : conservés, jamais forcés', () => {
  it('vocabulaire non reconnu → axis unknown, normalized null, brut conservé', () => {
    const r = normalizeDocumentVerdict('foobar zzz', kf)
    expect(r.axis).toBe('unknown')
    expect(r.normalized).toBeNull()
    expect(r.raw).toBe('foobar zzz')
  })
  it('codes ambigus (lettre seule, chiffre, couleur) SANS contexte probant → null', () => {
    // Contexte neutre (pas de grille de conformité) → la chaîne seule ne décide pas.
    const neutral = { family: 'knowledge_fact', thematicCategory: 'progress' }
    for (const v of ['C', 'A', '2', 'vert', 'rouge']) {
      const r = normalizeDocumentVerdict(v, neutral)
      expect(r.normalized).toBeNull()
      expect(r.axis).toBe('unknown')
    }
  })
  it('token thématique égaré (forecast / permanent_instruction) → axe thematic, null', () => {
    for (const v of ['forecast', 'permanent_instruction']) {
      const r = normalizeDocumentVerdict(v, kf)
      expect(r.axis).toBe('thematic')
      expect(r.normalized).toBeNull()
    }
  })
  it('verdict absent → unknown null', () => {
    expect(normalizeDocumentVerdict(null, kf).normalized).toBeNull()
    expect(normalizeDocumentVerdict('', kf).axis).toBe('unknown')
  })
})

describe('E1 — codes courts C/NC : la chaîne seule ne décide jamais, le contexte peut', () => {
  it("1. « NC » sans contexte probant → normalized null (ambigu, conservé)", () => {
    const r = normalizeDocumentVerdict('NC', { family: 'knowledge_fact' })
    expect(r.normalized).toBeNull()
    expect(r.raw).toBe('NC')
  })
  it("2. « C » sans contexte probant → normalized null", () => {
    expect(normalizeDocumentVerdict('C', { family: 'knowledge_fact' }).normalized).toBeNull()
  })
  it("3. « NC » dans une colonne État d'une grille de conformité → compliant_negative", () => {
    const r = normalizeDocumentVerdict('NC', { family: 'knowledge_fact', field: 'État' })
    expect(r.axis).toBe('compliance')
    expect(r.normalized).toBe('compliant_negative')
    expect(r.confidence).toBe('medium')
  })
  it("4. « C » dans une colonne État → compliant_positive", () => {
    const r = normalizeDocumentVerdict('C', { family: 'knowledge_fact', field: 'Etat' })
    expect(r.axis).toBe('compliance')
    expect(r.normalized).toBe('compliant_positive')
  })
  it("3bis. proxy générique : thematic_category=test_control suffit (données actuelles)", () => {
    expect(normalizeDocumentVerdict('NC', { family: 'knowledge_fact', thematicCategory: 'test_control' }).normalized).toBe('compliant_negative')
  })
  it("5. contre-exemple : « NC » dans un contexte NON probant (commentaire/progress) → null", () => {
    const r = normalizeDocumentVerdict('NC', { family: 'knowledge_fact', field: 'Commentaire', thematicCategory: 'progress' })
    expect(r.normalized).toBeNull()
  })
  it("garde : le code n'est pas résolu hors famille porteuse d'état", () => {
    expect(normalizeDocumentVerdict('NC', { family: 'person', field: 'État' }).normalized).toBeNull()
  })
})

describe('E1 — E ne projette PAS vers l\'état (garde de périmètre)', () => {
  it('la capture ne contient aucun champ resolved/open/unknown de state_status', () => {
    const r = normalizeDocumentVerdict('non vérifié', kf)
    // le contrat E1 s'arrête au verdict + axe + confiance ; pas de state.
    expect(Object.keys(r).sort()).toEqual(['axis', 'confidence', 'normalized', 'raw', 'reason', 'source'])
  })
})
