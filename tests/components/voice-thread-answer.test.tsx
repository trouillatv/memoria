// Fil de la conversation vocale — l'orbe n'imprime jamais de Markdown.
//
// Défaut à l'origine de ces tests (retour Vincent, 16/08) : « On voit par exemple
// du **markdown** dans la longue réponse de préparation de visite. Ça avait été
// corrigé dans CopilotAnswer pour la surface normale, mais manifestement la
// surface vocale affiche encore le texte brut. »
//
// L'invariant vérifié ici est donc celui-là, et il est vérifié sur la FORME
// RÉELLE produite par le LLM sur un plan de visite, pas sur un cas d'école.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceThreadAnswer } from '@/components/field/VoiceThreadAnswer'

// Relevé sur PETRO ATTITI — plan de visite, forme réellement observée.
const PLAN = `Pour votre visite de demain, je vous conseille 2 contrôles :
1. **Gestion du matériel sur site non sécurisé**
   * **À vérifier sur place :** Constater l'état réel du stockage.
   * **Pourquoi ce contrôle :** Le sujet est mentionné 4 fois de suite sans changement d'état.
   * **Dernier état connu :** vérifié sur le terrain le 13 août.
2. **Absence de courant**
   * **À vérifier sur place :** Confirmer la remise en service du tableau.
   * **Pourquoi ce contrôle :** Modifié le 13 août 2026.

Vous n'avez encore ajouté aucun point personnel à votre plan de visite.`

describe('VoiceThreadAnswer — aucun balisage n’atteint l’écran', () => {
  it('un plan de visite complet ne laisse passer ni astérisque ni dièse', () => {
    const { container } = render(<VoiceThreadAnswer text={PLAN} />)
    const shown = container.textContent ?? ''
    expect(shown).not.toMatch(/\*/)
    expect(shown).not.toMatch(/^#/m)
    // Les étiquettes brutes du modèle ne sont pas non plus recopiées telles quelles.
    expect(shown).not.toContain('À vérifier sur place :')
  })

  it('le gras libre d’un paragraphe est interprété, pas imprimé', () => {
    render(<VoiceThreadAnswer text="Le **SSI** a évolué depuis votre passage." />)
    expect(screen.getByText('SSI').tagName).toBe('STRONG')
    expect(screen.getByText(/a évolué depuis votre passage/)).toBeTruthy()
  })

  it('conserve la première lecture de chaque contrôle : numéro, titre, constat', () => {
    render(<VoiceThreadAnswer text={PLAN} />)
    expect(screen.getByText('Gestion du matériel sur site non sécurisé')).toBeTruthy()
    expect(screen.getByText("Constater l'état réel du stockage.")).toBeTruthy()
    // Le signal de récurrence est calculé par `toControlView`, partagé avec la
    // surface écrite : même lecture, rendu plus léger.
    expect(screen.getByText(/Revient depuis 4 passages sans changement/)).toBeTruthy()
  })

  it('une réponse courte sans balisage traverse sans être dégradée', () => {
    const t = "Aucune action en retard sur ce chantier à ce jour."
    const { container } = render(<VoiceThreadAnswer text={t} />)
    expect(container.textContent).toBe(t)
  })
})
