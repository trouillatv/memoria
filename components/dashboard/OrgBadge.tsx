// M3 — badge d'organisation. Provenance DISCRÈTE sur une carte du dashboard, pour
// répondre à la seule question du compte multi-org : « cette carte appartient à
// quelle entreprise ? ». Purement présentationnel : aucune logique, aucun filtre,
// aucune organisation active.
//
// Contrat : ne rend RIEN sans libellé. Le libellé n'existe que pour un compte
// multi-organisations (la page ne construit la map que dans ce cas) → en mono-org
// l'interface est visuellement inchangée, sans aucune condition dans les widgets.

// Objet SIMPLE (pas une Map) : ces libellés traversent la frontière serveur →
// client (DashboardInbox), et une Map n'est pas sérialisable dans les props RSC.
export type OrgLabels = Record<string, string> | null

/** Le libellé d'une organisation (ou `undefined` en mono-org / id inconnu). */
export function orgLabelOf(labels: OrgLabels, organizationId: string | null | undefined): string | undefined {
  if (!labels || !organizationId) return undefined
  return labels[organizationId]
}

export function OrgBadge({ label }: { label?: string | null }) {
  if (!label) return null
  return (
    <span
      className="inline-flex shrink-0 items-center rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground align-middle"
      title={`Organisation : ${label}`}
    >
      {label}
    </span>
  )
}
