'use client'

import { useCallback, useState } from 'react'

/**
 * Mode contrôlé OPTIONNEL et rétro-compatible.
 *
 * Les panneaux d'action du chantier (Action, Note/photo, Compte-rendu,
 * Livraison, Document, Brief, Copilote) portaient chacun leur propre
 * `useState(open)` ET leur propre déclencheur : rien ne pouvait les ouvrir
 * depuis une autre surface. La barre d'actions mobile (Phase 2) a besoin de
 * cette entrée.
 *
 * Plutôt que de déplacer leur logique, on leur ajoute une PORTE : si le parent
 * fournit `open`, il pilote ; sinon le composant garde exactement l'état interne
 * qu'il avait avant. Aucun appel existant n'a à changer, aucun comportement
 * existant ne bouge.
 */
export function useControllableOpen({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}): [boolean, (next: boolean) => void] {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = useCallback(
    (next: boolean) => {
      // En mode contrôlé l'état interne n'est plus la vérité : on ne le touche
      // pas (sinon deux sources d'ouverture divergeraient au premier aller-retour).
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  return [open, setOpen]
}
