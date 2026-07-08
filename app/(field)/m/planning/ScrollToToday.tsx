'use client'

import { useEffect } from 'react'

/**
 * Ouvre la timeline CENTRÉE sur aujourd'hui (le temps est continu — on n'atterrit
 * pas en haut du passé). Scrolle une seule fois, à l'ouverture, vers l'ancre du
 * jour. Ne fait rien si l'ancre n'existe pas.
 */
export function ScrollToToday({ anchorId }: { anchorId: string }) {
  useEffect(() => {
    const el = document.getElementById(anchorId)
    if (el) el.scrollIntoView({ block: 'center' })
  }, [anchorId])
  return null
}
