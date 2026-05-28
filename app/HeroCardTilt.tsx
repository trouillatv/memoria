'use client'

import { useRef } from 'react'

/**
 * Wrapper client minimal qui applique un léger tilt 3D au mouvement souris.
 * Pas de librairie : juste onMouseMove → CSS vars + transition courte = effet
 * naturel sans dépendance.
 *
 * Respecte prefers-reduced-motion : on lit la media query à chaque move et on
 * skippe la mise à jour si l'utilisateur l'a désactivé OS-side. La carte reste
 * statique dans ce cas — pas d'animation orpheline.
 */
export function HeroCardTilt({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  function reduced(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced()) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Origine au centre, normalisé entre -0.5 et 0.5
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    // Amplitude max : 4° (Kowalski : subtil, jamais théâtral)
    el.style.setProperty('--tilt-x', `${y * -4}deg`)
    el.style.setProperty('--tilt-y', `${x * 4}deg`)
  }

  function handleLeave() {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tilt-x', '0deg')
    el.style.setProperty('--tilt-y', '0deg')
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`[transform-style:preserve-3d] [transform:perspective(1400px)_rotateX(var(--tilt-x,0deg))_rotateY(var(--tilt-y,0deg))] transition-transform duration-300 ease-[var(--ease-out-landing)] will-change-transform [--tilt-x:0deg] [--tilt-y:0deg] ${className}`}
    >
      {children}
    </div>
  )
}
