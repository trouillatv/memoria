'use client'

import { useState, useEffect, useCallback } from 'react'

export type ViewMode = 'cards' | 'list'

export function useViewMode(defaultMode: ViewMode = 'cards'): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(defaultMode)
  useEffect(() => {
    const stored = localStorage.getItem('library-view-mode')
    if (stored === 'cards' || stored === 'list') setMode(stored)
  }, [])
  const update = useCallback((m: ViewMode) => {
    setMode(m)
    localStorage.setItem('library-view-mode', m)
  }, [])
  return [mode, update]
}
