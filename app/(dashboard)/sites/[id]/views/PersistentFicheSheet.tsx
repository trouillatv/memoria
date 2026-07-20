'use client'

// ── LA COQUILLE PERSISTANTE DU PARCOURS (Lot 2 · PR1 « Coquille persistante ») ──
// Le contrat : « le Sheet n'est plus démonté ». Auparavant, `?action=`, `?decision=`
// et `?person=` montaient TROIS deep-links distincts, chacun avec son propre
// <Sheet> (Dialog Root base-ui) : passer d'un objet à l'autre DÉTRUISAIT une fiche
// pour en recréer une autre — un vrai ferme/rouvre au DOM.
//
// Ici, UN seul <Sheet> reste monté tant qu'un maillon est actif ; naviguer d'un
// objet à l'autre garde `open=true` et ne change que le CORPS. Le navigateur ne
// recrée plus la fiche → la continuité vient de l'architecture, pas d'une animation.
//
// Périmètre PR1 STRICT : aucune animation, aucun crossfade, aucun changement visuel.
// Ouverture initiale (rien → une fiche) et fermeture totale (une fiche → rien)
// gardent EXACTEMENT le comportement d'origine (montage/démontage du Sheet).

/* eslint-disable react-hooks/refs -- Comparaison VOLONTAIRE de l'identité précédente
   pendant le rendu : c'est la seule façon de distinguer « la fiche APPARAÎT » (aucune
   animation interne — le panneau qui arrive explique déjà le changement) de « la fiche
   CHANGE D'OBJET » (transformation). Un state + effet ajouterait les classes APRÈS
   l'ouverture, ce qui déclencherait précisément l'animation qu'on veut éviter. Cette
   valeur ne pilote que des classes CSS de transition — jamais une donnée affichée. */

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ActionFicheBody } from './action/ActionFiche'
import { DecisionFicheBody } from './decision/DecisionFiche'
import { IntervenantFicheBody } from './intervenants/IntervenantFiche'
import type { TrailBack } from '@/components/knowledge/FicheTrail'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import type { DecisionFicheData } from '@/lib/knowledge/decision-fiche'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'

export function PersistentFicheSheet({ siteId, person, action, decision }: {
  siteId: string
  person: IntervenantPerson | null
  action: ActionFicheData | null
  decision: DecisionFicheData | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // Un seul maillon actif à la fois : les liens croisés suppriment l'autre param
  // (cf. IntervenantFiche `actionHref`/`decisionHref`, decision-fiche, action-fiche).
  const active: 'action' | 'decision' | 'person' | null =
    action ? 'action' : decision ? 'decision' : person ? 'person' : null

  // PR2 — l'IDENTITÉ de l'objet affiché. Quand elle change, seul le CORPS est
  // remonté : la transformation se rejoue. La COQUILLE n'est jamais remontée (PR1).
  const contentKey = active ? `${active}:${params.get(active) ?? ''}` : null

  // ── FERMER NE DOIT RIEN ATTENDRE ───────────────────────────────────────────
  // Fermer ne charge AUCUNE donnée : rien du serveur n'est nécessaire pour faire
  // disparaître le panneau. Or l'URL pilotait seule l'affichage, donc le panneau
  // restait à l'écran le temps que le serveur recalcule toute la page — ~3 s
  // observées en production, pour un geste qui n'a rien à demander à personne.
  // On ferme donc TOUT DE SUITE, et l'URL se met à jour derrière.
  const [closingKey, setClosingKey] = useState<string | null>(null)

  // Fermer retire le param du maillon courant + sa source, sans perdre l'onglet.
  // Identique aux ex-deep-links (mêmes clés supprimées).
  function close() {
    setClosingKey(contentKey)
    const next = new URLSearchParams(params.toString())
    if (active === 'action') { next.delete('action'); next.delete('action_source'); next.delete('action_site') }
    else if (active === 'decision') { next.delete('decision'); next.delete('decision_source') }
    else if (active === 'person') { next.delete('person'); next.delete('person_source') }
    next.delete('from_person')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Le retour vers la PERSONNE d'où l'on vient : `?person=` a été retiré de l'URL
  // au moment du saut, donc seul `from_person` sait vers qui revenir.
  const fromPerson = params.get('from_person')
  function backToPersonHref(personId: string): string {
    const q = new URLSearchParams(params.toString())
    q.delete('action'); q.delete('action_source'); q.delete('action_site')
    q.delete('decision'); q.delete('decision_source'); q.delete('from_person')
    q.set('person', personId)
    const qs = q.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  // « Remonter l'histoire » : le « ← » ramène au maillon d'où l'on vient. Ce
  // retour ne concerne plus seulement les origines CAUSALES (décision ↔ action) :
  // arriver depuis un Intervenant sans pouvoir y revenir était une impasse — or
  // c'est le Retour qui distingue « je suis allé quelque part » de « j'ai ouvert
  // une fenêtre ». (Révision assumée d'un détail du Lot 1.)
  const back: TrailBack | null =
    active === 'action' && params.get('action_source') === 'decision' && action?.fromDecision
      ? { typeLabel: 'Décision', href: action.fromDecision.href }
      : active === 'decision' && params.get('decision_source') === 'action' && decision?.action
        ? { typeLabel: 'Action', href: decision.action.href }
        : fromPerson && (active === 'action' || active === 'decision')
          ? { typeLabel: 'Intervenant', href: backToPersonHref(fromPerson) }
          : null

  // Une fois la fermeture prise en compte par l'URL, on oublie la fermeture
  // optimiste — sinon revenir en arrière rouvrirait une fiche encore marquée
  // « fermée », et le panneau resterait invisible.
  if (closingKey !== null && contentKey === null) setClosingKey(null)
  const isClosing = closingKey !== null && closingKey === contentKey

  // DEUX ÉVÉNEMENTS ≠ DEUX GESTES : à l'OUVERTURE (aucun contenu précédent), le
  // panneau qui arrive explique déjà le changement → on n'anime PAS le contenu.
  // Sur un CHANGEMENT D'OBJET (un contenu était déjà là), le mouvement explique
  // « tu es toujours ici, mais ce que tu regardes a changé » → on anime.
  const previousKeyRef = useRef<string | null>(null)
  const isObjectChange = previousKeyRef.current !== null && previousKeyRef.current !== contentKey
  useEffect(() => { previousKeyRef.current = contentKey }, [contentKey])

  // Rien d'actif → aucune fiche montée (comportement d'origine à la fermeture).
  if (!active) return null

  return (
    <Sheet open={!isClosing} onOpenChange={(o) => { if (!o) close() }}>
      {/* Le × reste TOUJOURS disponible. Le Lot 1 le masquait dès qu'un « ← »
          existait (deux sorties concurrentes sur ce qui était encore une modale) ;
          en chaînant Décision → Action → retour, `back` est défini à chaque étape
          et le panneau n'offrait donc PLUS AUCUNE sortie visible — il fallait
          deviner Échap ou le clic-dehors. Maintenant que le panneau est un espace
          de navigation, les deux gestes ne se concurrencent plus : « ← » remonte
          d'un cran (haut-gauche, dans le fil), « × » quitte l'espace (haut-droite). */}
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {active === 'action' && <ActionFicheBody key={contentKey} action={action} back={back} animateContent={isObjectChange} />}
        {active === 'decision' && <DecisionFicheBody key={contentKey} decision={decision} back={back} animateContent={isObjectChange} />}
        {active === 'person' && person && <IntervenantFicheBody key={contentKey} siteId={siteId} person={person} animateContent={isObjectChange} />}
      </SheetContent>
    </Sheet>
  )
}
