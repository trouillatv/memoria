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

  // Fermer retire le param du maillon courant + sa source, sans perdre l'onglet.
  // Identique aux ex-deep-links (mêmes clés supprimées).
  function close() {
    const next = new URLSearchParams(params.toString())
    if (active === 'action') { next.delete('action'); next.delete('action_source'); next.delete('action_site') }
    else if (active === 'decision') { next.delete('decision'); next.delete('decision_source') }
    else if (active === 'person') { next.delete('person'); next.delete('person_source') }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // « Remonter l'histoire » : selon la provenance, le « ← » ramène au maillon amont
  // (logique reprise telle quelle des ex-deep-links Action et Décision).
  const back: TrailBack | null =
    active === 'action' && params.get('action_source') === 'decision' && action?.fromDecision
      ? { typeLabel: 'Décision', href: action.fromDecision.href }
      : active === 'decision' && params.get('decision_source') === 'action' && decision?.action
        ? { typeLabel: 'Action', href: decision.action.href }
        : null

  // Rien d'actif → aucune fiche montée (comportement d'origine à la fermeture).
  if (!active) return null

  // PR2 — l'IDENTITÉ de l'objet affiché. Quand elle change, seul le CORPS est
  // remonté : la transformation (crossfade titre/chapô, glissement du corps) se
  // rejoue. La COQUILLE, elle, n'est jamais remontée — c'est l'acquis de PR1.
  const contentKey = `${active}:${params.get(active) ?? ''}`

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent side="right" showCloseButton={!back} className="w-full overflow-y-auto sm:max-w-md">
        {active === 'action' && <ActionFicheBody key={contentKey} action={action} back={back} />}
        {active === 'decision' && <DecisionFicheBody key={contentKey} decision={decision} back={back} />}
        {active === 'person' && person && <IntervenantFicheBody key={contentKey} siteId={siteId} person={person} />}
      </SheetContent>
    </Sheet>
  )
}
