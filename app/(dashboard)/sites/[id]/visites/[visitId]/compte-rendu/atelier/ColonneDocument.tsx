'use client'

// LES MARCHES 1 ET 3 DU PARCOURS, ET LE FIL ENTRE ELLES.
//
// « Mettre à jour les propositions » disparaissait après le premier clic, et ne
// revenait jamais. Or ce qu'il calcule est déduit du TEXTE du compte-rendu :
// corriger une section ensuite laissait à l'écran une liste qui décrivait un
// texte qui n'existe plus. Périmée, et silencieuse — le seul recours était un
// « Relire » discret en haut à droite que rien n'invitait à cliquer.
//
// Les deux blocs sont voisins mais étrangers : l'un édite, l'autre déduit, et
// aucun ne connaît l'autre. Ce composant est le fil — et rien d'autre. Il ne
// détient ni le document ni les propositions : il compte simplement combien de
// fois le texte a changé, et laisse la concrétisation décider si cela la
// périme. C'est le plus petit couplage qui règle le problème.
//
// POURQUOI ICI, ET PAS DANS LES COMPOSANTS PARTAGÉS : `CrDocumentSections` et
// `CrConcretisation` servent aussi le mobile et l'ancienne page de bureau. Les
// deux rappels qu'ils exposent (`onEdited`, `documentRevision`) sont OPTIONNELS
// et sans effet quand personne ne les branche. Le fil, lui, vit dans l'atelier :
// supprimer ce dossier suffit toujours à défaire l'expérience.
//
// CE QU'IL NE FAIT PAS : recalculer tout seul. Une relecture est un aller-retour
// serveur, et le conducteur est peut-être en train de corriger la section
// suivante. MemorIA signale, l'humain déclenche.

import { useState } from 'react'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'
import { CrDocumentSections } from '@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections'
import { CrConcretisation } from '@/app/(field)/m/visite/[reportId]/cr/CrConcretisation'

export function ColonneDocument({
  reportId,
  sections,
  status,
}: {
  reportId: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
}) {
  // Un compteur, pas un drapeau : deux corrections de suite doivent périmer une
  // préparation lancée entre les deux. Un booléen se serait fait remettre à zéro
  // par la première relecture qui revient.
  const [revision, setRevision] = useState(0)

  return (
    <>
      <CrDocumentSections
        reportId={reportId}
        sections={sections}
        status={status}
        onEdited={() => setRevision((n) => n + 1)}
      />
      {/* TROISIÈME MARCHE — `asStep` retire son total global, qui entrait en
          concurrence avec le compteur de décisions du panneau d'arbitrage. */}
      <CrConcretisation reportId={reportId} asStep documentRevision={revision} />
    </>
  )
}
