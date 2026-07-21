'use client'

// LES DEUX COLONNES, ET LES DEUX FILS QUI LES RELIENT.
//
// Trois blocs voisins mais étrangers : le document qu'on corrige, le travail
// restant, et ce qui sera créé. Chacun ignore les autres — et cette ignorance
// produisait deux mensonges d'écran :
//
//   1. CORRIGER une section périmait ce que la concrétisation avait déduit du
//      texte, sans que rien ne le dise. La liste continuait de décrire un texte
//      qui n'existe plus.
//   2. CRÉER dans le chantier referme les propositions satisfaites (mig 231),
//      donc le travail restant diminue — mais le panneau, chargé une fois pour
//      toutes, annonçait le même nombre juste après le clic. Le conducteur
//      avait l'impression que son geste n'avait servi à rien.
//
// Ce composant est le fil, et rien d'autre. Il ne détient ni le document, ni
// les propositions, ni le travail restant : il compte deux événements — le
// texte a changé, des objets sont nés — et laisse chaque bloc décider de ce que
// ça lui fait. C'est le plus petit couplage qui règle les deux.
//
// POURQUOI DES COMPTEURS, PAS DES BOOLÉENS : deux corrections de suite doivent
// périmer une préparation lancée entre les deux. Un drapeau se serait fait
// remettre à zéro par la première relecture revenue.
//
// POURQUOI ICI, ET PAS DANS LES COMPOSANTS PARTAGÉS : `CrDocumentSections`,
// `CrConcretisation` et `MemoriaRetained` servent aussi le mobile et l'ancienne
// page de bureau. Les rappels qu'ils exposent (`onEdited`, `documentRevision`,
// `onCreated`) sont OPTIONNELS et sans effet quand personne ne les branche. Le
// fil, lui, vit dans l'atelier : supprimer ce dossier défait l'expérience.
//
// CE QU'IL NE FAIT PAS : recalculer tout seul après une correction. Une
// relecture est un aller-retour serveur, et le conducteur est peut-être en
// train de corriger la section suivante. MemorIA signale, l'humain déclenche.
// Après une CRÉATION, en revanche, la relecture est automatique : le travail a
// réellement changé en base, et personne n'a à le redemander.

import { useState } from 'react'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'
import type { VisitCrDoc } from '@/lib/db/visits'
import { CrDocumentSections } from '@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections'
import { CrConcretisation } from '@/app/(field)/m/visite/[reportId]/cr/CrConcretisation'
import { MemoriaRetained } from '@/app/(field)/m/visite/[reportId]/cr/MemoriaRetained'
import { PanneauArbitrage } from './PanneauArbitrage'

export function AtelierColonnes({
  reportId,
  siteId,
  sections,
  status,
  transcriptions,
}: {
  reportId: string
  siteId: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
  // Le type vient du contrat de `buildVisitCrDoc`, jamais réécrit à la main :
  // une copie divergerait sans que rien ne le signale.
  transcriptions: VisitCrDoc['transcriptions']
}) {
  const [revisionTexte, setRevisionTexte] = useState(0)
  const [creations, setCreations] = useState(0)

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* ── LE DOCUMENT — ce que le chantier saura ─────────────────────────── */}
      <main className="min-w-0 flex-1 space-y-4 lg:order-1">
        {/* MARCHE 1 — je corrige. */}
        <CrDocumentSections
          reportId={reportId}
          sections={sections}
          status={status}
          onEdited={() => setRevisionTexte((n) => n + 1)}
        />
        {/* MARCHE 3 — je vois ce qui sera créé. `asStep` retire son total
            global, qui entrait en concurrence avec le travail restant. */}
        <CrConcretisation
          reportId={reportId}
          asStep
          documentRevision={revisionTexte}
          onCreated={() => setCreations((n) => n + 1)}
        />
        {/* L'ANALYSE D'ORIGINE DEVIENT LA PROVENANCE. Elle ne charge rien tant
            qu'on ne la demande pas, et ne raconte plus l'histoire une seconde
            fois au-dessus du document. */}
        <MemoriaRetained
          reportId={reportId}
          siteId={siteId}
          transcriptions={transcriptions}
          autoLoad={false}
        />
      </main>

      {/* ── MARCHE 2 — je termine les arbitrages qui restent ───────────────── */}
      <aside className="lg:sticky lg:top-6 lg:order-2 lg:w-[360px] lg:shrink-0">
        <PanneauArbitrage reportId={reportId} rechargerA={creations} />
      </aside>
    </div>
  )
}
