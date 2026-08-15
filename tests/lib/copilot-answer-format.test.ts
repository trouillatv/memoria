import { describe, it, expect } from 'vitest'
import {
  parseCopilotAnswer,
  shortFieldLabel,
  stripBold,
  toControlView,
  type CopilotAnswerBlock,
} from '@/lib/visits/copilot-answer-format'

// Texte réellement produit par le Copilote en production le 15/08 sur PETRO
// ATTITI (relevé par scripts/recette-p1a-copilote-petro.ts). C'est ce corpus,
// pas une forme supposée, que le rendu doit savoir lire.
const REPONSE_PLAN_VISITE = `Pour votre visite de demain, je vous conseille 5 contrôles :
1. **Dépose du SSI et matériel incendie : identification du responsable**
   * **À vérifier sur place :** Constater l'état réel après l'évolution enregistrée, et confirmer qu'elle est conforme.
   * **Pourquoi ce contrôle :** Modifié le 13 août 2026, après votre dernier passage.
   * **Dernier état connu :** vérifié sur le terrain · dernière trace le 13 août 2026.
   * **Changement depuis votre dernière visite :** Évolution enregistrée le 13 août 2026, après votre visite du 11 août 2026.
2. **Gestion du matériel sur site non sécurisé**
   * **À vérifier sur place :** Constater l'état réel. Le sujet revient sans que son état change.
   * **Pourquoi ce contrôle :** Modifié le 13 août 2026 · mentionné 4 fois de suite sans changement d'état.

Vous n'avez encore ajouté aucun point personnel à votre plan de visite.`

describe('parseCopilotAnswer — plan de visite réel', () => {
  const blocks = parseCopilotAnswer(REPONSE_PLAN_VISITE)

  it('ouvre par la phrase d’introduction, en paragraphe', () => {
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      text: 'Pour votre visite de demain, je vous conseille 5 contrôles :',
    })
  })

  it('reconnaît chaque contrôle numéroté et son titre sans marqueur Markdown', () => {
    const controls = blocks.filter((b) => b.kind === 'control')
    expect(controls).toHaveLength(2)
    expect(controls[0]).toMatchObject({
      index: '1',
      title: 'Dépose du SSI et matériel incendie : identification du responsable',
    })
    expect(controls[1]).toMatchObject({ index: '2', title: 'Gestion du matériel sur site non sécurisé' })
  })

  it('conserve les quatre champs et raccourcit leurs étiquettes', () => {
    const first = blocks.find((b) => b.kind === 'control')
    if (first?.kind !== 'control') throw new Error('contrôle attendu')
    expect(first.fields.map((f) => f.label)).toEqual([
      'À vérifier',
      'Pourquoi',
      'Dernier état',
      'Évolution',
    ])
    // Aucune donnée perdue : la valeur reste intégrale.
    expect(first.fields[1].value).toBe('Modifié le 13 août 2026, après votre dernier passage.')
  })

  it('rend la mention du plan personnel comme un paragraphe final', () => {
    expect(blocks[blocks.length - 1]).toEqual({
      kind: 'paragraph',
      text: "Vous n'avez encore ajouté aucun point personnel à votre plan de visite.",
    })
  })

  it('ne laisse aucun astérisque Markdown dans le texte affiché', () => {
    const rendu = blocks
      .flatMap((b) =>
        b.kind === 'control' ? [b.title, ...b.fields.map((f) => f.value)] : [b.text])
      .join('\n')
    expect(rendu).not.toContain('**')
  })
})

describe('parseCopilotAnswer — sûreté du repli', () => {
  it('rend une réponse courte en un seul paragraphe', () => {
    expect(parseCopilotAnswer('Aucun élément ne mérite votre attention.')).toEqual([
      { kind: 'paragraph', text: 'Aucun élément ne mérite votre attention.' },
    ])
  })

  it('garde une puce hors contrôle comme puce, sans la perdre', () => {
    const blocks = parseCopilotAnswer('Trois points :\n- **Accès** au chantier')
    expect(blocks[1]).toEqual({ kind: 'bullet', text: 'Accès au chantier' })
  })

  it('n’avale pas un champ dont l’étiquette est inconnue', () => {
    const blocks = parseCopilotAnswer('1. **Titre**\n   * **Responsable :** Guillaume')
    if (blocks[0]?.kind !== 'control') throw new Error('contrôle attendu')
    expect(blocks[0].fields[0]).toEqual({ label: 'Responsable', value: 'Guillaume' })
  })
})

describe('toControlView — deux niveaux de lecture', () => {
  const controls = parseCopilotAnswer(REPONSE_PLAN_VISITE).filter(
    (b): b is Extract<CopilotAnswerBlock, { kind: 'control' }> => b.kind === 'control',
  )
  const sansRecurrence = toControlView(controls[0])
  const avecRecurrence = toControlView(controls[1])

  it('met « À vérifier » en information principale', () => {
    expect(sansRecurrence.check).toBe(
      "Constater l'état réel après l'évolution enregistrée, et confirmer qu'elle est conforme.",
    )
  })

  it('résume un sujet récurrent en un signal d’alerte chiffré', () => {
    expect(avecRecurrence.signal).toEqual({
      text: 'Revient depuis 4 passages sans changement',
      tone: 'warning',
    })
  })

  it('utilise le « Pourquoi » comme signal neutre quand il n’y a pas de récurrence', () => {
    expect(sansRecurrence.signal).toEqual({
      text: 'Modifié le 13 août 2026, après votre dernier passage.',
      tone: 'neutral',
    })
  })

  it('sort la consigne de récurrence du « À vérifier » sans la jeter', () => {
    expect(avecRecurrence.check).toBe("Constater l'état réel.")
    expect(avecRecurrence.details).toContainEqual({
      label: 'À creuser',
      value: 'Le sujet revient sans que son état change.',
    })
  })

  it('replie dernier état et évolution dans le détail', () => {
    expect(sansRecurrence.details.map((f) => f.label)).toEqual(['Dernier état', 'Évolution'])
    expect(sansRecurrence.details[1].value).toBe(
      'Évolution enregistrée le 13 août 2026, après votre visite du 11 août 2026.',
    )
  })

  it('ne perd aucune information : tout champ d’origine reste atteignable', () => {
    for (const [control, view] of [
      [controls[0], sansRecurrence],
      [controls[1], avecRecurrence],
    ] as const) {
      const rendu = [
        view.check ?? '',
        view.signal?.text ?? '',
        ...view.details.map((f) => f.value),
      ].join('\n')

      for (const field of control.fields) {
        // Les fragments de la valeur d'origine — dates, chiffres, phrases — sont
        // tous accessibles, soit en première lecture, soit en dépliant.
        for (const fragment of field.value.split(/\s*[·.]\s*/).filter((f) => f.length > 8)) {
          expect(rendu).toContain(fragment)
        }
      }
    }
  })

  it('ne casse pas un contrôle sans champ reconnu', () => {
    const blocks = parseCopilotAnswer('1. **Titre**\n   * **Responsable :** Guillaume')
    if (blocks[0]?.kind !== 'control') throw new Error('contrôle attendu')
    const view = toControlView(blocks[0])
    expect(view).toMatchObject({ index: '1', title: 'Titre', check: null, signal: null })
    expect(view.details).toEqual([{ label: 'Responsable', value: 'Guillaume' }])
  })
})

describe('shortFieldLabel', () => {
  it('absorbe les variantes de rédaction du LLM', () => {
    expect(shortFieldLabel('Pourquoi')).toBe('Pourquoi')
    expect(shortFieldLabel('Pourquoi ce contrôle')).toBe('Pourquoi')
    expect(shortFieldLabel('Changement depuis votre dernière visite')).toBe('Évolution')
    expect(shortFieldLabel('Évolution depuis votre dernière visite')).toBe('Évolution')
  })

  it('laisse intacte une étiquette qu’il ne connaît pas', () => {
    expect(shortFieldLabel('Intervenant concerné')).toBe('Intervenant concerné')
  })
})

describe('stripBold', () => {
  it('retire le gras sans toucher au reste', () => {
    expect(stripBold('**Titre** du contrôle')).toBe('Titre du contrôle')
  })
})
