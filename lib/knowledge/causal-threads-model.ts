// ── MÉMOIRE CAUSALE — assemblage PUR d'un fil ────────────────────────────────
// Un « fil causal par engagement » relie les objets d'un chantier PAR LES LIENS
// RÉELS. La doctrine vit ici, testable : trois relations, jamais confondues.
//   · 'produit'  (→) : une cause portée par le chantier (Réunion→Décision,
//                      Décision→Action, Réserve→sa levée, Action→sa clôture).
//   · 'lie'      (—) : une relation certaine, SANS affirmer de cause (une action
//                      CONCERNE une réserve — la réserve n'a pas « décidé »).
//   · 'rupture'  (⇢) : lien non établi — jamais fabriqué, jamais présenté en cause.
// On ne déduit JAMAIS une causalité d'une simple proximité temporelle.

export type CausalRelation = 'produit' | 'lie' | 'rupture'
export type CausalNodeKind = 'reunion' | 'visite' | 'decision' | 'action' | 'reserve' | 'cloture'

export interface CausalNode {
  kind: CausalNodeKind
  label: string
  detail: string | null
  href: string | null
}

/** Un pas du fil = un nœud + la relation qui le rattache au précédent (null pour le 1ᵉʳ). */
export interface CausalStep {
  node: CausalNode
  relationFromPrev: CausalRelation | null
}

export interface CausalThread {
  /** Ancré sur l'action (l'engagement). */
  id: string
  title: string
  subtitle: string | null
  steps: CausalStep[]
}

/** Parts déjà RÉSOLUES (par le read model serveur) pour une action. Aucune I/O ici. */
export interface CausalParts {
  actionId: string
  action: CausalNode
  /** La décision dont l'action découle (reverse-lookup), avec sa réunion source éventuelle. */
  decision: { node: CausalNode; meeting: CausalNode | null } | null
  /** L'origine PROPRE de l'action quand il n'y a pas de décision : réunion/visite. */
  origin: CausalNode | null
  /** La réserve que l'action CONCERNE (lien, jamais cause), et sa levée éventuelle. */
  reserve: { node: CausalNode; lift: CausalNode | null } | null
  /** La clôture de l'action (si terminée et sans réserve porteuse de la preuve). */
  cloture: CausalNode | null
  title: string
  subtitle: string | null
}

/**
 * Assemble le fil dans l'ordre : POURQUOI (réunion → décision, ou origine) →produit→
 * ACTION —lié→ RÉSERVE →produit→ levée, ou ACTION →produit→ clôture. Chaque relation
 * est TYPÉE : jamais une action « produite » par une réserve, jamais une décision
 * « causée » par une visite. Le fil s'arrête là où les liens réels s'arrêtent.
 */
export function assembleThread(p: CausalParts): CausalThread {
  const steps: CausalStep[] = []

  // ── Amont : le « pourquoi » ──
  if (p.decision) {
    if (p.decision.meeting) {
      steps.push({ node: p.decision.meeting, relationFromPrev: null })
      steps.push({ node: p.decision.node, relationFromPrev: 'produit' })
    } else {
      steps.push({ node: p.decision.node, relationFromPrev: null })
    }
    steps.push({ node: p.action, relationFromPrev: 'produit' })
  } else if (p.origin) {
    steps.push({ node: p.origin, relationFromPrev: null })
    steps.push({ node: p.action, relationFromPrev: 'produit' })
  } else {
    steps.push({ node: p.action, relationFromPrev: null })
  }

  // ── Aval : la conséquence ──
  if (p.reserve) {
    // L'action CONCERNE la réserve (— lié), jamais « produite par » elle.
    steps.push({ node: p.reserve.node, relationFromPrev: 'lie' })
    if (p.reserve.lift) steps.push({ node: p.reserve.lift, relationFromPrev: 'produit' })
  } else if (p.cloture) {
    steps.push({ node: p.cloture, relationFromPrev: 'produit' })
  }

  return { id: p.actionId, title: p.title, subtitle: p.subtitle, steps }
}
