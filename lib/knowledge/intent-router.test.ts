// Tests unitaires — classifyIntent (routeur d'intention Lot 4C)
//
// Cas couverts (exemples du spec 4C) :
//  - Route A : questions de pilotage global
//  - Route B : connaissance structurée ciblée
//  - Route C : questions documentaires / preuves
//  - Route B par défaut (absence de pattern A ou C)
//  - Dimensions B adaptatives selon mots-clés
//  - Robustesse accents / majuscules

import { describe, it, expect } from 'vitest'
import { classifyIntent } from './intent-router'

describe('Route C — documentaire', () => {
  const examples = [
    'Que disait le PV du 12 mars ?',
    'Quelles dimensions sont prévues au CCTP ?',
    "Montre-moi ce qui a été écrit sur la ventilation.",
    'Que disait le PV 008 sur les essais ?',
    'Donne-moi un extrait du compte-rendu de juillet.',
    'Dans le document, qu\'a dit le MOE ?',
    'PV008 parle de quoi exactement ?',
    'Retrouve l\'extrait du CR sur les réserves.',
  ]

  it.each(examples)('"%s" → C', (q) => {
    expect(classifyIntent(q).route).toBe('C')
  })

  it('route C a useRetrieval=true', () => {
    expect(classifyIntent('Que disait le PV 008 ?').useRetrieval).toBe(true)
  })
})

describe('Route A — situation/pilotage', () => {
  const examples = [
    "Qu'est-ce qui mérite mon attention ?",
    "Qu'est-ce qui bloque ce chantier ?",
    "Où en est le chantier ?",
    "Quels sujets stagnent ?",
    'Quel est l\'état général du chantier ?',
    'Quelles sont les urgences ?',
    'Quelles sont les priorités ?',
    'Donne-moi une synthèse du chantier.',
    'Vue d\'ensemble du chantier.',
    'Bilan global.',
  ]

  it.each(examples)('"%s" → A', (q) => {
    expect(classifyIntent(q).route).toBe('A')
  })

  it('route A a useRetrieval=false', () => {
    expect(classifyIntent("Qu'est-ce qui mérite mon attention ?").useRetrieval).toBe(false)
  })

  it('route A active toutes les dimensions', () => {
    const { ctxOptions } = classifyIntent("Qu'est-ce qui mérite mon attention ?")
    expect(ctxOptions.attention).toBe(true)
    expect(ctxOptions.subjects).toBe(true)
    expect(ctxOptions.activeObjects).toBe(true)
    expect(ctxOptions.relations).toBe(true)
    expect(ctxOptions.actors).toBe(true)
    expect(ctxOptions.timeline).toBe(true)
    expect(ctxOptions.blockages).toBe(true)
  })
})

describe('Route B — connaissance structurée ciblée', () => {
  const examples = [
    'Qui est responsable du VRD ?',
    'Quelles réserves concernent la peinture ?',
    'De quoi dépend la réception G3 ?',
    'Quelles actions sont ouvertes sur les réserves béton ?',
    'Quelle entreprise s\'occupe de la charpente ?',
    'Qui est l\'interlocuteur principal ?',
  ]

  it.each(examples)('"%s" → B', (q) => {
    expect(classifyIntent(q).route).toBe('B')
  })

  it('route B a useRetrieval=false', () => {
    expect(classifyIntent('Qui est responsable du VRD ?').useRetrieval).toBe(false)
  })
})

describe('Route B par défaut', () => {
  it('question inconnue → B', () => {
    expect(classifyIntent('Quel est le numéro de téléphone du maître d\'ouvrage ?').route).toBe('B')
  })

  it('question courte sans pattern → B', () => {
    expect(classifyIntent('Les réserves ?').route).toBe('B')
  })
})

describe('Dimensions B adaptatives', () => {
  it('"Qui est responsable" → actors=true', () => {
    expect(classifyIntent('Qui est responsable de la réception ?').ctxOptions.actors).toBe(true)
  })

  it('"De quoi dépend" → relations=true', () => {
    expect(classifyIntent('De quoi dépend la réception G3 ?').ctxOptions.relations).toBe(true)
  })

  it('"Quelles actions" → activeObjects=true', () => {
    expect(classifyIntent('Quelles actions sont ouvertes sur ce sujet ?').ctxOptions.activeObjects).toBe(true)
  })

  it('"Quel blocage" → blockages=true', () => {
    expect(classifyIntent('Quel blocage retarde le chantier ?').ctxOptions.blockages).toBe(true)
  })

  it('question B sans keyword spécifique → attention+subjects uniquement', () => {
    const opts = classifyIntent('Donne-moi des informations sur ce chantier.').ctxOptions
    expect(opts.attention).toBe(true)
    expect(opts.subjects).toBe(true)
    expect(opts.actors).toBeFalsy()
    expect(opts.relations).toBeFalsy()
    expect(opts.blockages).toBeFalsy()
    expect(opts.activeObjects).toBeFalsy()
  })
})

describe('Robustesse', () => {
  it('insensible aux accents manquants', () => {
    expect(classifyIntent("Qu'est-ce qui merite mon attention ?").route).toBe('A')
  })

  it('insensible aux majuscules', () => {
    expect(classifyIntent('QUE DISAIT LE PV 008 ?').route).toBe('C')
  })

  it('priorité C > A (question qui mentionne les deux)', () => {
    // Contient "PV" (C) ET "bloque" (A) → C gagne
    expect(classifyIntent('Le PV bloque-t-il le chantier ?').route).toBe('C')
  })
})
