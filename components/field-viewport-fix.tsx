'use client'

// Correctif viewport pour Chrome Android en mode "Site pour ordinateur".
//
// Chrome ignore width=device-width dans ce mode et force innerWidth=980.
// screen.width reste à la vraie largeur physique (< 640 sur téléphone).
// On détecte ce décalage et on corrige le viewport meta dynamiquement.

import { useEffect } from 'react'

export function FieldViewportFix() {
  useEffect(() => {
    if (screen.width < 640 && window.innerWidth > 640) {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
      if (meta) meta.content = `width=${screen.width}, initial-scale=1`
    }
  }, [])
  return null
}
