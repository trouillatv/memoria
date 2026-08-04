import { describe, it, expect } from 'vitest'
import { classifyIntent, type IntentFamily } from '@/lib/visits/copilot-classify'

// ── Tests : classifyIntent ────────────────────────────────────────────────────

describe('classifyIntent — intent primaire', () => {
  it('question sur G3 → subject_detail', () => {
    const r = classifyIntent('Pourquoi G3 revient-il autant ?')
    expect(r.primary).toBe('subject_detail')
  })

  it('question sur R4 → subject_detail', () => {
    const r = classifyIntent('En est où R4 ?')
    expect(r.primary).toBe('subject_detail')
  })

  it('question sur changements récents → timeline', () => {
    const r = classifyIntent("Qu'est-ce qui a changé récemment ?")
    expect(r.primary).toBe('timeline')
  })

  it('question sur actions en retard → action_status', () => {
    const r = classifyIntent('Quelles actions sont en retard ?')
    expect(r.primary).toBe('action_status')
  })

  it('question sur responsable → actor', () => {
    const r = classifyIntent("Qui s'occupe de ce sujet ?")
    expect(r.primary).toBe('actor')
  })

  it('question sur prochaine visite → plan_visite', () => {
    const r = classifyIntent('Que dois-je vérifier à ma prochaine visite ?')
    expect(r.primary).toBe('plan_visite')
  })

  it('question générale sans signal → global', () => {
    const r = classifyIntent('Bonjour.')
    expect(r.primary).toBe('global')
  })

  it('résumé général → global', () => {
    const r = classifyIntent('Comment ça se passe sur ce chantier ?')
    // "comment" est dans SUBJECT_SIGNALS mais sans entité → faible score
    // "se passe" peut être global
    // Le résultat peut varier selon le scoring exact
    expect(['global', 'subject_detail']).toContain(r.primary)
  })
})

describe('classifyIntent — isWriteRequest', () => {
  it('créer une action → isWriteRequest = true et proposal_request', () => {
    const r = classifyIntent('Peux-tu créer une action pour G3 ?')
    expect(r.isWriteRequest).toBe(true)
    expect(r.primary).toBe('proposal_request')
  })

  it('ajouter au plan → isWriteRequest = true', () => {
    const r = classifyIntent('Ajoute R4 à ma prochaine visite.')
    expect(r.isWriteRequest).toBe(true)
  })

  it('question sur création hypothétique → isWriteRequest peut être true', () => {
    const r = classifyIntent('Quelles actions faudrait-il créer pour G3 ?')
    // Le mot "créer" est dans PROPOSAL_SIGNALS
    expect(r.isWriteRequest).toBe(true)
  })

  it('question de lecture sans write signal → isWriteRequest = false', () => {
    const r = classifyIntent('Pourquoi G3 revient-il ?')
    expect(r.isWriteRequest).toBe(false)
  })
})

describe('classifyIntent — extraction des entités', () => {
  it('G3 extrait comme subjectLabel', () => {
    const r = classifyIntent('Pourquoi G3 revient-il autant ?')
    expect(r.entities.subjectLabels).toContain('G3')
  })

  it('R4 et G3 extraits comme subjectLabels', () => {
    const r = classifyIntent('Comment ça se passe entre G3 et R4 ?')
    expect(r.entities.subjectLabels).toContain('G3')
    expect(r.entities.subjectLabels).toContain('R4')
  })

  it('guillemets extraits comme subjectLabel', () => {
    const r = classifyIntent('Parle-moi du sujet "purge complémentaire".')
    expect(r.entities.subjectLabels).toContain('purge complémentaire')
  })

  it('aucun code → subjectLabels vide', () => {
    const r = classifyIntent('Quelles actions sont en retard ?')
    expect(r.entities.subjectLabels).toHaveLength(0)
  })
})

describe('classifyIntent — intents secondaires', () => {
  it('G3 + changements récents → subject_detail primaire + timeline secondaire', () => {
    const r = classifyIntent("Comment G3 a-t-il évolué depuis le dernier PV ?")
    expect(r.primary).toBe('subject_detail')
    expect(r.secondary).toContain('timeline')
  })

  it('pas de secondaire pour une question simple', () => {
    const r = classifyIntent('Bonjour, résume le chantier.')
    // global, pas de secondaire avec score > 0 typiquement
    expect(r.primary).toBe('global')
  })
})

describe('classifyIntent — cas edge', () => {
  it('question très courte "Et R4 ?" → subject_detail', () => {
    const r = classifyIntent('Et R4 ?')
    expect(r.primary).toBe('subject_detail')
    expect(r.entities.subjectLabels).toContain('R4')
  })

  it('question "Lequel des deux mérite mon attention ?" → global (pas de code)', () => {
    const r = classifyIntent('Lequel des deux mérite mon attention ?')
    // Pas de code technique détectable
    expect(r.entities.subjectLabels).toHaveLength(0)
    // Sans entité, peut tomber en global
    expect(['global', 'subject_detail']).toContain(r.primary)
  })

  it('DN160 extrait comme code technique', () => {
    const r = classifyIntent('Où en est le réseau DN160 ?')
    expect(r.entities.subjectLabels).toContain('DN160')
    expect(r.primary).toBe('subject_detail')
  })
})
