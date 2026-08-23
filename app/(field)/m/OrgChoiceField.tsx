'use client'

// -- « SOCIÉTÉ » — LA QUESTION QU'ON NE POSE QUE SI ELLE SE POSE -------------
//
// Un chantier appartient à une organisation. Quand le compte n'en a qu'une, la
// réponse est évidente et demander serait une friction gratuite : le champ
// n'existe pas. Dès qu'il y en a deux, plus rien dans le parcours ne dit s'il
// s'agit d'AGP ou de Becib — ni le nom saisi, ni la photo WhatsApp reçue. Le
// champ apparaît alors, et il est OBLIGATOIRE.
//
// Ce qu'on ne fait jamais : pré-sélectionner. Une valeur par défaut se valide
// sans être lue, et le chantier part dans la mauvaise entreprise en silence.
// Le placeholder n'est pas une option — c'est l'absence de réponse.
//
// Ce composant est un CONFORT, pas une autorisation : le serveur revalide
// (`resolveCreationOrgId`) puis revérifie l'appartenance (`createSite`).

import { useEffect, useState } from 'react'
import { listCreatableOrgsAction, type CreatableOrgOption } from './org-options-actions'

export interface OrgChoice {
  /** null tant que la liste n'est pas chargée. */
  orgs: CreatableOrgOption[] | null
  /** L'organisation retenue — auto en mono-org, choisie sinon. */
  orgId: string | null
  setOrgId: (id: string) => void
  /** Plusieurs organisations : il FAUT demander. */
  needsChoice: boolean
  /** Le formulaire peut-il être soumis du point de vue de l'organisation ? */
  ready: boolean
}

/**
 * `enabled` — on ne charge la liste qu'au moment où le formulaire de création
 * s'ouvre. Ouvrir le sélecteur de chantier ne doit pas coûter une lecture des
 * organisations : la plupart des parcours choisissent un chantier existant.
 */
export function useOrgChoice(enabled: boolean): OrgChoice {
  const [orgs, setOrgs] = useState<CreatableOrgOption[] | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || orgs !== null) return
    listCreatableOrgsAction()
      .then((list) => {
        setOrgs(list)
        // Mono-org : la réponse est connue, on la retient sans rien demander.
        if (list.length === 1) setOrgId(list[0].id)
      })
      .catch(() => setOrgs([]))
  }, [enabled, orgs])

  const needsChoice = (orgs?.length ?? 0) > 1
  return { orgs, orgId, setOrgId, needsChoice, ready: !needsChoice || !!orgId }
}

export function OrgChoiceField({
  choice,
  disabled,
  className,
}: {
  choice: OrgChoice
  disabled?: boolean
  className?: string
}) {
  // Mono-org (ou liste pas encore chargée) : aucun champ. Silence positif.
  if (!choice.needsChoice) return null

  return (
    <div className="space-y-1.5">
      <label htmlFor="org-choice" className="text-xs font-medium text-muted-foreground">
        Société *
      </label>
      <select
        id="org-choice"
        value={choice.orgId ?? ''}
        onChange={(e) => choice.setOrgId(e.target.value)}
        disabled={disabled}
        className={className ?? 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'}
      >
        <option value="" disabled>
          Choisir…
        </option>
        {(choice.orgs ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground">
        Vous travaillez pour plusieurs sociétés — indiquez à laquelle rattacher ce chantier.
      </p>
    </div>
  )
}
