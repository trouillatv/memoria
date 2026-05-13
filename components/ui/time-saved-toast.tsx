'use client'

// Sprint 5 — UX-9 « Temps retrouvé » (Doctrine V5).
//
// Reconnaissance discrète après une action critique. Confirme le travail
// accompli SANS gamification, SANS félicitation, SANS marketing.
//
// Doctrine V5 — verrous appliqués :
//   - Pilier 2 : réduit charge mentale, augmente confiance.
//   - Verrou V1 : aucune recommandation, aucune injonction.
//   - Verrou V4 : aucune formulation de contrôle humain. Aucun « Bravo »,
//     « Excellent », « Félicitations », emoji 🎉, « Super », « Wow ».
//
// Wording autorisé :
//   - "Rapport préparé en 42 secondes"
//   - "12 photos déjà regroupées"
//   - "Dossier prêt à partager"
//   - "Mémoire mise à jour"
//   - "Note sauvegardée"
//
// Le style est volontairement sobre : palette slate, fond presque blanc,
// petite police. Le but est une présence subtile, pas un événement visuel.

import { toast } from 'sonner'

/**
 * Affiche un toast sobre de reconnaissance discrète après une action critique.
 *
 * Le message DOIT être factuel et passif. Aucune formulation de félicitation
 * ne doit être passée. Un grep CI vérifie l'absence de wording marketing
 * dans le fichier hébergeant ce helper.
 */
export function showTimeSavedToast(message: string) {
  toast(message, {
    duration: 3000,
    className: 'text-xs cn-time-saved',
    style: {
      background: 'rgba(248, 250, 252, 0.95)',
      color: 'rgb(71, 85, 105)',
      border: '1px solid rgb(226, 232, 240)',
    },
  })
}
