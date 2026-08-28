'use client'

// Chrome de navigation chantier PARTAGÉ (Lot Navigation, 2026-08-29).
//
// Un seul et même bandeau d'identité + onglets sur toutes les routes de l'espace
// chantier (Aperçu, Chronologie via ?tab=, Suivi et ses sous-vues, Réserves,
// Actions…). Objectif produit : à n'importe quel endroit de la page, David sait
// qu'il est dans « BELLA NAPOLI » et peut revenir à l'Aperçu.
//
// Compact et STICKY : le bandeau reste collé en haut au scroll (identité + nav
// toujours visibles) sans consommer la hauteur utile — pas d'énorme header
// sticky. Sur l'Aperçu, le hero complet reste au-dessus, non sticky ; ce bandeau
// se colle en dessous. Sur les sous-routes, il porte l'identité à lui seul.
//
// Client component pour le `position: sticky` + la cohérence de rendu ; il ne
// recalcule AUCUNE donnée métier (identité passée en props par le serveur).
// SiteTabsNav est un composant pur (Link + cn) : sûr à l'intérieur d'un client.

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SiteTabsNav, type SiteTabKey } from './SiteTabsNav'

export function SiteChantierNav({
  siteId,
  siteName,
  clientName,
  activeTab,
}: {
  siteId: string
  siteName: string
  clientName?: string | null
  activeTab: SiteTabKey
}) {
  return (
    <div className="sticky top-0 z-30 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      {/* Ligne d'identité compacte — nom du chantier toujours perceptible + retour Aperçu. */}
      <div className="flex items-center gap-2 pt-2">
        <Link
          href={`/sites/${siteId}`}
          aria-label="Revenir à l'aperçu du chantier"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{siteName}</span>
          {clientName ? (
            <span className="truncate text-xs text-muted-foreground">· {clientName}</span>
          ) : null}
        </div>
      </div>

      {/* Onglets N2 — SiteTabsNav porte son propre border-b. */}
      <div className="mt-1.5">
        <SiteTabsNav active={activeTab} siteId={siteId} />
      </div>
    </div>
  )
}
