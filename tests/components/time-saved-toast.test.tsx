// Sprint 5 UX-9 — Temps retrouvé (Doctrine V5).
//
// Tests de showTimeSavedToast : confirmation discrète après action critique.
//
// Doctrine vérifiée :
//   - Le toast appelle sonner avec le message brut (pas de wrapping marketing).
//   - Aucun wording de félicitation/gamification dans le message.
//   - Style sobre appliqué (palette slate, fond presque blanc, petite police).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// On mocke sonner avant import du composant.
vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

import { toast } from 'sonner'
import { showTimeSavedToast } from '@/components/ui/time-saved-toast'

describe('showTimeSavedToast — Sprint 5 UX-9', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appelle sonner avec le message factuel passé en argument', () => {
    showTimeSavedToast('Rapport préparé · 12 photos sélectionnées')
    expect(toast).toHaveBeenCalledTimes(1)
    const [message] = (toast as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(message).toBe('Rapport préparé · 12 photos sélectionnées')
  })

  it('n\'introduit AUCUN wording marketing — Bravo, Excellent, Félicitations, 🎉, Super, Wow', () => {
    // Le helper passe le message tel quel — il ne doit pas le pré-formater.
    const samples = [
      'Rapport préparé en 42 secondes',
      'Note ajoutée à ce site',
      'Dossier prêt à partager · lien copié',
      'Résultat enregistré',
      'Mémoire mise à jour',
    ]
    for (const s of samples) {
      showTimeSavedToast(s)
    }
    const mockedToast = toast as unknown as ReturnType<typeof vi.fn>
    for (const call of mockedToast.mock.calls) {
      const message = String(call[0])
      // Verrou V4 : aucune formulation de félicitation/contrôle.
      expect(message).not.toMatch(/bravo|excellent|félicitations|gagné|🎉|super|wow/i)
    }
  })

  it('applique un style sobre (palette slate, petite police, fond presque blanc)', () => {
    showTimeSavedToast('Note sauvegardée')
    const mockedToast = toast as unknown as ReturnType<typeof vi.fn>
    const opts = mockedToast.mock.calls[0]?.[1] as {
      duration?: number
      className?: string
      style?: { background?: string; color?: string; border?: string }
    }
    expect(opts.duration).toBe(3000)
    expect(opts.className).toMatch(/text-xs/)
    // Fond presque blanc (slate 50 ish, opacité quasi totale).
    expect(opts.style?.background).toMatch(/248,\s*250,\s*252/)
    // Texte slate-600 (71/85/105).
    expect(opts.style?.color).toMatch(/71,\s*85,\s*105/)
    // Bordure slate-200 (226/232/240).
    expect(opts.style?.border).toMatch(/226,\s*232,\s*240/)
  })
})
