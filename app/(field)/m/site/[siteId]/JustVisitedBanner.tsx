'use client'

// Petit bandeau « vivant » : en revenant sur la fiche après avoir terminé une
// visite, le conducteur voit immédiatement que son action a eu un effet sur le
// chantier. Éphémère : disparaît après quelques secondes OU au premier défilement.

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

export function JustVisitedBanner() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000)
    const hide = () => setVisible(false)
    window.addEventListener('scroll', hide, { passive: true, once: true })
    return () => { clearTimeout(t); window.removeEventListener('scroll', hide) }
  }, [])

  return (
    <div
      aria-live="polite"
      className={`overflow-hidden transition-all duration-500 ${visible ? 'max-h-16 opacity-100' : 'pointer-events-none max-h-0 opacity-0'}`}
    >
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-emerald-600" />
        Visite enregistrée · ajoutée à l’historique du chantier
      </div>
    </div>
  )
}
