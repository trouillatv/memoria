'use client'

// Lien "Retour" contextuel : utilise l'historique navigateur (page précédente
// dans l'app), avec fallback vers `fallbackHref` quand on arrive par URL
// directe (référent vide ou cross-origin).
//
// Pourquoi : un Link href="/sites/X" forcé fait perdre le contexte si je suis
// arrivé sur /interventions/abc depuis /briefing ou /aujourdhui. Ce composant
// rend la navigation arrière fidèle au flow réel.

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Props {
  /** Page à afficher si le browser history est inutilisable (accès direct,
   *  référent externe). Doit toujours être fourni — sécurité UX. */
  fallbackHref: string
  /** Texte par défaut affiché. Ex. "Retour au site". */
  label: string
  /** Variante visuelle. */
  size?: 'sm' | 'md'
}

export function SmartBackLink({ fallbackHref, label, size = 'sm' }: Props) {
  const router = useRouter()

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    // Stratégie de détection (Vincent 2026-05-20) :
    //  1. window.history.length > 1 ⇒ il y a au moins une page précédente
    //     dans l'historique côté browser → router.back() ramène à la vraie
    //     page d'origine (ex. /semaine quand on clique sur une intervention).
    //  2. Sinon (accès direct, lien externe), fallback explicite.
    //
    // document.referrer n'est PAS fiable en Next.js App Router : les
    // navigations côté client via <Link> ne le mettent pas à jour, donc
    // l'heuristique précédente faisait toujours tomber sur le fallback.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  const sizeCls = size === 'md'
    ? 'text-sm'
    : 'text-xs'
  const iconCls = size === 'md' ? 'h-4 w-4' : 'h-3 w-3'

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 ${sizeCls} text-muted-foreground hover:text-foreground active:text-foreground`}
    >
      <ArrowLeft className={iconCls} />
      {label}
    </button>
  )
}
