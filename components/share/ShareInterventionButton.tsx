'use client'

// Slice M1 — Doctrine V5 Pilier 3 "Frontières humaines"
//
// Bouton "Partager" qui :
//  1. Construit un message texte format ready-to-paste WhatsApp
//  2. Copie dans le presse-papier (fallback) OU utilise navigator.share() (mobile)
//
// Doctrine V5 :
//  - Pas de notification, pas de tracking d'ouverture, pas de presence implicite.
//  - L'URL pointe vers la route INTERNE /interventions/[id] (auth requise).
//    Pour partage public anonyme à un client externe, utiliser "Préparer le
//    dossier" depuis /preuves/[id] (flow Slice B existant).
//
// Cible : Maeva colle dans WhatsApp en 2 secondes pour briefing rapide.

import { useState, useTransition } from 'react'
import { Share2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  /** Texte à partager — préformaté côté server-side (mission, site, date, slot). */
  text: string
  /** URL absolue à insérer dans le message. Sera assemblé `{text}\n{url}`. */
  url: string
  /** Variante visuelle. `inline` = bouton compact dans une row ; `default` = bouton header. */
  variant?: 'default' | 'inline'
  label?: string
}

export function ShareInterventionButton({
  text,
  url,
  variant = 'default',
  label = 'Partager',
}: Props) {
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    const payload = `${text}\nDétails : ${url}`
    startTransition(async () => {
      // Mobile : utilise l'API native de partage si dispo (déclenche le menu OS)
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ text: payload })
          return
        } catch (e) {
          // L'utilisateur a annulé OU le navigateur a refusé — on retombe sur copy.
          // Pas de toast d'erreur (cancel = comportement normal).
          if (
            e instanceof Error &&
            (e.name === 'AbortError' || e.message.toLowerCase().includes('cancel'))
          ) {
            return
          }
        }
      }
      // Fallback : copie presse-papier
      try {
        await navigator.clipboard.writeText(payload)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        toast.success('Copié — collez dans WhatsApp ou email', {
          duration: 3000,
        })
      } catch {
        toast.error('Impossible de copier. Sélectionnez le texte manuellement.')
      }
    })
  }

  const isInline = variant === 'inline'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1.5 transition-colors disabled:opacity-50',
        isInline
          ? 'text-xs text-muted-foreground hover:text-foreground'
          : 'rounded-lg border bg-card hover:bg-muted text-sm font-medium px-3 h-8',
      )}
      title="Partager (WhatsApp, email…)"
    >
      {copied ? (
        <Check className={isInline ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      ) : (
        <Share2 className={isInline ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      )}
      <span>{copied ? 'Copié' : label}</span>
    </button>
  )
}
