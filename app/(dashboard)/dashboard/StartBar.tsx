'use client'

// Barre « Démarrer » — accueil (Vincent 2026-06-23).
//
// Raccourcis de création + invite d'installation mobile (PWA). Sobre et
// REPLIABLE : respecte la doctrine [[dashboard-collapse-editorial]] (« apparaît
// au bon moment puis se retire »). Une ligne discrète, jamais un mur de boutons.
// Masquable (mémorisé par appareil) ; l'invite d'install disparaît si l'app est
// déjà installée ou non installable.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MapPin, FileText, Users, Smartphone, X, Plus, Share } from 'lucide-react'

const DISMISS_KEY = 'memoria.startbar.dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// « Démarrer » = entrées de création, sobres. PAS « Atelier IA » : c'est le même
// domaine que « Dossier de démarrage » (les AO), et un espace de travail INTERNE à
// un dossier, pas une action de démarrage → redondant, retiré (Vincent 2026-06-27).
const SHORTCUTS = [
  { href: '/sites', label: 'Chantier', icon: MapPin },
  { href: '/tenders/new', label: 'Dossier de démarrage', icon: FileText },
  { href: '/equipes', label: 'Équipe', icon: Users },
]

export function StartBar() {
  const [hidden, setHidden] = useState(true) // caché jusqu'à lecture du localStorage (anti-flash)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [showIOSHelp, setShowIOSHelp] = useState(false)

  useEffect(() => {
    setHidden(localStorage.getItem(DISMISS_KEY) === '1')

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    const ua = navigator.userAgent || ''
    setIsIOS(/iphone|ipad|ipod/i.test(ua))
    setStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    )

    const onInstalled = () => setDeferred(null)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (hidden) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setHidden(true)
  }

  async function install() {
    if (deferred) {
      await deferred.prompt()
      setDeferred(null)
    } else if (isIOS) {
      setShowIOSHelp((v) => !v)
    }
  }

  // L'invite d'installation : visible si installable (Android/Chrome) ou iOS, et
  // jamais si déjà installée.
  const canInstall = !standalone && (deferred !== null || isIOS)

  return (
    <section
      aria-label="Démarrer"
      className="rounded-lg border bg-muted/20 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mr-1">
          Démarrer
        </span>

        {SHORTCUTS.map((s) => {
          const Icon = s.icon
          return (
            <Link
              key={s.href}
              href={s.href}
              className="group inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <Plus className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
              <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
              {s.label}
            </Link>
          )
        })}

        {canInstall && (
          <button
            type="button"
            onClick={install}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 transition-colors hover:bg-brand-100 dark:bg-brand-950/30 dark:text-brand-200"
          >
            <Smartphone className="h-3.5 w-3.5" />
            Installer l&apos;app
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          title="Masquer"
          aria-label="Masquer la barre Démarrer"
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {showIOSHelp && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Sur iPhone : touchez <Share className="inline h-3.5 w-3.5" /> (Partager) puis
          « Sur l&apos;écran d&apos;accueil ».
        </p>
      )}
    </section>
  )
}
