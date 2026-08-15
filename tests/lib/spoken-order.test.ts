import { describe, it, expect } from 'vitest'
import {
  checkSpokenFollowsEngine,
  mentionedControlIndexes,
  announcesControlCount,
  discriminantsOf,
} from '@/lib/voice/spoken-order'

// Les cinq contrôles réellement produits par `buildVisitPlan` sur PETRO ATTITI
// le 2026-08-15, dans l'ordre du moteur. Des libellés réels et non inventés :
// c'est leur longueur et leurs mots partagés ("gestion", "matériel") qui font
// la difficulté de la détection.
const PETRO = [
  'Dépose du SSI et matériel incendie : identification du responsable',
  'Gestion du matériel sur site non sécurisé',
  'Installation et gestion du nouveau toilette pour équipes cuisines',
  'Dépôt de suie sur les panneaux électriques',
  'Absence de courant au tableau de distribution (TD)',
]

describe('discriminantsOf — reconnaître un contrôle malgré l’abrègement', () => {
  it('écarte les mots partagés par plusieurs contrôles', () => {
    const d = discriminantsOf(PETRO)
    // "gestion" apparaît dans #2 et #3 : il ne peut identifier ni l'un ni l'autre.
    expect(d.flat()).not.toContain('gestion')
    // "incendie" n'appartient qu'à #1 : il l'identifie à lui seul.
    expect(d[0]).toContain('incendie')
  })

  it('deux libellés identiques ne sont discriminés par rien', () => {
    expect(discriminantsOf(['Reprise du joint', 'Reprise du joint'])).toEqual([[], []])
  })
})

describe('announcesControlCount — la voix dit COMBIEN', () => {
  it.each([
    ['en chiffres', 'Cinq contrôles ressortent, dont 5 prioritaires.', true],
    ['en toutes lettres', 'Il y a cinq points à vérifier demain.', true],
    ['sans le nombre', 'Deux sujets ressortent nettement.', false],
  ])('%s', (_label, spoken, expected) => {
    expect(announcesControlCount(spoken, 5)).toBe(expected)
  })

  it('ne confond pas un autre nombre présent dans la phrase', () => {
    expect(announcesControlCount('Trois sujets ont évolué.', 5)).toBe(false)
  })
})

describe('mentionedControlIndexes — ordre d’apparition, pas ordre du moteur', () => {
  it('reconnaît un contrôle abrégé par le modèle', () => {
    // Le libellé fait neuf mots, la voix en dit trois : une comparaison par
    // proportion de mots communs échouerait ici.
    expect(mentionedControlIndexes('Commencez par la dépose du SSI.', PETRO)).toEqual([0])
  })

  it('restitue l’ordre dans lequel la voix les prononce', () => {
    const spoken = 'Le dépôt de suie d’abord, puis la dépose du SSI.'
    expect(mentionedControlIndexes(spoken, PETRO)).toEqual([3, 0])
  })

  it('ne reconnaît rien dans une phrase générique', () => {
    expect(mentionedControlIndexes("Rien d'urgent aujourd'hui.", PETRO)).toEqual([])
  })
})

describe('checkSpokenFollowsEngine — le contrat oral figé par Vincent', () => {
  // « La voix peut résumer 2 ou 3 points sur 5, mais elle doit annoncer qu'il y
  // en a 5 et les points qu'elle verbalise doivent être les plus prioritaires
  // selon MemorIA, pas deux points choisis librement par le LLM. »

  it('annonce l’étendue puis détaille #1, #2, #3 dans l’ordre → contrat tenu', () => {
    const spoken =
      "Cinq points ressortent pour demain. D'abord la dépose du SSI et l'identification du responsable, "
      + "ensuite le matériel laissé sur une zone non sécurisée, enfin le nouveau toilette des équipes cuisines."
    const c = checkSpokenFollowsEngine(spoken, PETRO)
    expect(c.mentioned).toEqual([0, 1, 2])
    expect(c.announcesTotal).toBe(true)
    expect(c.followsEngineOrder).toBe(true)
    expect(c.isEnginePrefix).toBe(true)
    expect(c.ok).toBe(true)
  })

  it('un seul contrôle détaillé reste conforme s’il s’agit du premier', () => {
    const c = checkSpokenFollowsEngine('Cinq contrôles, à commencer par la dépose du SSI.', PETRO)
    expect(c.mentioned).toEqual([0])
    expect(c.ok).toBe(true)
  })

  it('sélection libre : #2 et #5 sans le premier → contrat rompu', () => {
    // Le défaut réellement observé avant le correctif : deux contrôles retenus
    // « librement », qui laissent croire que MemorIA n'en a trouvé que deux.
    const spoken = "Deux sujets : le matériel non sécurisé et l'absence de courant au tableau."
    const c = checkSpokenFollowsEngine(spoken, PETRO)
    expect(c.mentioned).toEqual([1, 4])
    expect(c.isEnginePrefix).toBe(false)
    expect(c.ok).toBe(false)
  })

  it('bon sous-ensemble mais ordre inversé → contrat rompu', () => {
    const spoken = 'Cinq points. Le matériel non sécurisé, puis la dépose du SSI.'
    const c = checkSpokenFollowsEngine(spoken, PETRO)
    expect(c.mentioned).toEqual([1, 0])
    expect(c.isEnginePrefix).toBe(true)   // ce sont bien les deux premiers…
    expect(c.followsEngineOrder).toBe(false) // …mais énoncés à l'envers
    expect(c.ok).toBe(false)
  })

  it('ordre du moteur respecté mais étendue tue → contrat rompu', () => {
    const spoken = "La dépose du SSI, puis le matériel laissé sur zone non sécurisée."
    const c = checkSpokenFollowsEngine(spoken, PETRO)
    expect(c.followsEngineOrder).toBe(true)
    expect(c.isEnginePrefix).toBe(true)
    expect(c.announcesTotal).toBe(false)
    expect(c.ok).toBe(false)
  })

  it('une voix silencieuse échoue le contrat sans lever', () => {
    const c = checkSpokenFollowsEngine(null, PETRO)
    expect(c.ok).toBe(false)
    expect(c.mentioned).toEqual([])
  })

  it('aucun contrôle au plan : rien à contrôler, rien à exiger', () => {
    expect(checkSpokenFollowsEngine('Rien ne ressort.', []).ok).toBe(false)
  })
})
