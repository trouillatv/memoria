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
    // Si on a un référent same-origin, browser back permet de revenir à la
    // page précédente (et seul le browser history sait laquelle).
    const ref = typeof document !== 'undefined' ? document.referrer : ''
    let sameOrigin = false
    if (ref) {
      try {
        sameOrigin = new URL(ref).origin === window.location.origin
      } catch {
        sameOrigin = false
      }
    }
    if (sameOrigin) {
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
