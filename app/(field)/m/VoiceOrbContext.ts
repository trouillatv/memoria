'use client'

import { createContext, useContext } from 'react'

export type OpenOrbOptions = {
  siteId: string
  siteName?: string
  onResult: (text: string) => void
}

export type VoiceOrbContextValue = {
  openOrb: (opts: OpenOrbOptions) => void
}

export const VoiceOrbContext = createContext<VoiceOrbContextValue>({
  openOrb: () => {},
})

export function useVoiceOrb(): VoiceOrbContextValue {
  return useContext(VoiceOrbContext)
}
