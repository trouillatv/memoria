// ── ÉTAT D'ATTENTION D'UN ACTEUR (Lot 2B.3) ──────────────────────────────────
// Politique PURE et unique, consommée par TOUS les clients : la ligne du cockpit,
// les fiches, et le graphe demain. Le cockpit n'est pas une vue spéciale — il est
// un client de cette politique, au même titre que les fiches. Garantit qu'un acteur
// ne soit jamais vert dans une vue et rouge dans une autre.
//
// DOCTRINE (Vincent 2026-07-27) : « L'état d'attention d'un acteur décrit les faits
// opérationnels qui lui sont actuellement associés. Il n'évalue ni sa qualité, ni sa
// performance, ni sa fiabilité générale. » Ce n'est PAS une note de « santé ».
// Chaque état est TOUJOURS accompagné de ses raisons — jamais un niveau seul.

export type AttentionLevel = 'ok' | 'attention' | 'urgent'

/** Code stable d'une raison d'attention (partagé entre vues, jamais libellé en dur côté client). */
export type AttentionCode =
  // personne & entreprise
  | 'overdue_actions'          // urgent — au moins une action ouverte en retard
  | 'responsible_not_active'   // attention (personne) — porte une action mais plus mobilisée
  | 'agent_no_team'            // attention (personne) — agent interne sans équipe active
  | 'company_no_referent'      // attention (entreprise) — action(s) sans contact référent
  | 'company_left_casting'     // attention (entreprise) — responsable mais sortie du casting
  // équipe
  | 'team_empty_but_assigned'  // attention — affectée à un chantier mais sans aucun membre
  | 'team_no_member'           // attention — équipe sans aucun membre (même non affectée)
  | 'team_no_field_member'     // attention — a des comptes mais aucune personne terrain
  | 'member_orphan_actions'    // attention — un membre porte des actions sur un chantier quitté

export interface AttentionReason {
  code: AttentionCode
  /** Cardinalité du fait (nombre d'actions, etc.) ; 1 pour un fait booléen. */
  count: number
  /** Libellé lisible, déjà formaté (le client peut l'afficher tel quel). */
  label: string
}

export interface AttentionState {
  level: AttentionLevel
  /** Toujours renseigné dès que level ≠ 'ok'. Trié par sévérité décroissante. */
  reasons: AttentionReason[]
}

/** Faits opérationnels d'un acteur, discriminés par nature. Fournis par chaque read model. */
export type ActorFacts =
  | {
      kind: 'person'
      overdueActions: number
      /** Porte des actions ouvertes alors qu'elle n'est plus mobilisée (ni casting ni équipe). */
      responsibleButNotActive: boolean
      /** Agent interne sans équipe active (seule incomplétude qui bloque un usage métier). */
      internalAgentWithoutTeam: boolean
    }
  | {
      kind: 'company'
      overdueActions: number
      actionsWithoutReferent: number
      /** Responsable d'actions ouvertes mais absente du casting actif. */
      leftCastingWithOpenActions: boolean
    }
  | {
      kind: 'team'
      /** Affectée à au moins un chantier mais aucun membre (connecté ou terrain). */
      emptyButAssigned: boolean
      /** Aucun membre du tout (connecté ni terrain), même sans affectation. */
      noMembers: boolean
      /** A des comptes connectés mais aucune personne terrain (et l'équipe est active). */
      activeWithoutFieldMember: boolean
      /** Actions portées par des membres sur un chantier dont l'équipe est sortie. */
      memberOrphanActions: number
    }

const SEVERITY: Record<AttentionLevel, number> = { ok: 0, attention: 1, urgent: 2 }

function plural(n: number, singular: string, pluralSuffix = 's'): string {
  return `${n} ${singular}${n > 1 ? pluralSuffix : ''}`
}

/**
 * Dérive l'état d'attention à partir des faits. Le niveau est celui de la raison la
 * PLUS GRAVE (jamais une moyenne). Retourne toujours les raisons qui le justifient.
 */
export function deriveActorAttentionState(facts: ActorFacts): AttentionState {
  const reasons: Array<AttentionReason & { level: AttentionLevel }> = []

  if (facts.kind === 'person') {
    if (facts.overdueActions > 0) {
      reasons.push({ level: 'urgent', code: 'overdue_actions', count: facts.overdueActions, label: plural(facts.overdueActions, 'action') + ' en retard' })
    }
    if (facts.internalAgentWithoutTeam) {
      reasons.push({ level: 'attention', code: 'agent_no_team', count: 1, label: 'Agent sans équipe' })
    }
    if (facts.responsibleButNotActive) {
      reasons.push({ level: 'attention', code: 'responsible_not_active', count: 1, label: 'Responsable plus mobilisé' })
    }
  } else if (facts.kind === 'company') {
    if (facts.overdueActions > 0) {
      reasons.push({ level: 'urgent', code: 'overdue_actions', count: facts.overdueActions, label: plural(facts.overdueActions, 'action') + ' en retard' })
    }
    if (facts.actionsWithoutReferent > 0) {
      reasons.push({ level: 'attention', code: 'company_no_referent', count: facts.actionsWithoutReferent, label: plural(facts.actionsWithoutReferent, 'action') + ' sans référent' })
    }
    if (facts.leftCastingWithOpenActions) {
      reasons.push({ level: 'attention', code: 'company_left_casting', count: 1, label: 'Hors casting actif' })
    }
  } else {
    // Équipe — JAMAIS 'urgent' : elle n'est pas structurellement responsable des actions
    // de ses membres (aucun site_actions.assigned_team_id). Prudence assumée.
    if (facts.memberOrphanActions > 0) {
      reasons.push({ level: 'attention', code: 'member_orphan_actions', count: facts.memberOrphanActions, label: plural(facts.memberOrphanActions, 'action') + ' portée' + (facts.memberOrphanActions > 1 ? 's' : '') + ' hors casting' })
    }
    // Cascade du plus spécifique au plus général — une seule raison de composition.
    if (facts.emptyButAssigned) {
      reasons.push({ level: 'attention', code: 'team_empty_but_assigned', count: 1, label: 'Affectée mais vide' })
    } else if (facts.noMembers) {
      reasons.push({ level: 'attention', code: 'team_no_member', count: 1, label: 'Aucun membre' })
    } else if (facts.activeWithoutFieldMember) {
      reasons.push({ level: 'attention', code: 'team_no_field_member', count: 1, label: 'Aucun agent terrain' })
    }
  }

  reasons.sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])
  const level = reasons.reduce<AttentionLevel>((max, r) => (SEVERITY[r.level] > SEVERITY[max] ? r.level : max), 'ok')
  return { level, reasons: reasons.map((r) => ({ code: r.code, count: r.count, label: r.label })) }
}

/** Libellé UI du niveau (jamais « bonne/mauvaise santé »). */
export function attentionLevelLabel(level: AttentionLevel): string {
  switch (level) {
    case 'urgent': return 'À traiter'
    case 'attention': return 'À surveiller'
    case 'ok': return 'À jour'
  }
}
