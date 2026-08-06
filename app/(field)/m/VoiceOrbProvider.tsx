'use client'

import { useState, useCallback } from 'react'
import { VoiceOrbContext, type OpenOrbOptions } from './VoiceOrbContext'
import { VoiceOrbOverlay } from '@/components/field/VoiceOrbOverlay'

type OrbSession = OpenOrbOptions & { open: boolean }

const CLOSED: OrbSession = { open: false, siteId: '', onResult: () => {} }

export function VoiceOrbProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<OrbSession>(CLOSED)

  const openOrb = useCallback((opts: OpenOrbOptions) => {
    setSession({ open: true, ...opts })
  }, [])

  const closeOrb = useCallback(() => {
    setSession((prev) => ({ ...prev, open: false }))
  }, [])

  return (
    <VoiceOrbContext.Provider value={{ openOrb }}>
      {children}
      <VoiceOrbOverlay
        open={session.open}
        siteId={session.siteId}
        siteName={session.siteName}
        onResult={session.onResult}
        onClose={closeOrb}
      />
    </VoiceOrbContext.Provider>
  )
}
