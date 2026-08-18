'use client'

import { useState, useCallback, useRef } from 'react'
import { VoiceOrbContext, type OpenOrbOptions, type PendingProposal } from './VoiceOrbContext'
import { VoiceOrbOverlay } from '@/components/field/VoiceOrbOverlay'
import { VoiceLatencyBadge } from '@/components/field/VoiceLatencyBadge'

type OrbSession = OpenOrbOptions & { open: boolean }

const CLOSED: OrbSession = { open: false, siteId: '', onVoiceTurn: async () => {} }

export function VoiceOrbProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<OrbSession>(CLOSED)
  const [pendingProposals, setPendingProposals] = useState<PendingProposal[]>([])
  const viewHandlerRef = useRef<((id: string) => void) | null>(null)

  const openOrb = useCallback((opts: OpenOrbOptions) => {
    setSession({ open: true, ...opts })
  }, [])

  const closeOrb = useCallback(() => {
    setSession((prev) => ({ ...prev, open: false }))
  }, [])

  const addPendingProposal = useCallback((proposal: PendingProposal) => {
    setPendingProposals((prev) => [...prev, proposal])
  }, [])

  const removePendingProposal = useCallback((id: string) => {
    setPendingProposals((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const viewPendingProposal = useCallback((id: string) => {
    // La feuille est déjà ouverte sous l'orbe (elle est la seule à pouvoir
    // ouvrir l'orbe) : fermer suffit à la révéler, pas besoin de la rouvrir.
    closeOrb()
    viewHandlerRef.current?.(id)
  }, [closeOrb])

  const registerProposalViewHandler = useCallback((handler: ((id: string) => void) | null) => {
    viewHandlerRef.current = handler
  }, [])

  return (
    <VoiceOrbContext.Provider
      value={{
        openOrb,
        pendingProposals,
        addPendingProposal,
        removePendingProposal,
        viewPendingProposal,
        registerProposalViewHandler,
      }}
    >
      {children}
      <VoiceOrbOverlay
        open={session.open}
        siteId={session.siteId}
        siteName={session.siteName}
        onVoiceTurn={session.onVoiceTurn}
        onClose={closeOrb}
      />
      {/* Un seul point de montage pour les deux feuilles : la mesure est
          globale au parcours vocal, pas propre à une surface. */}
      <VoiceLatencyBadge />
    </VoiceOrbContext.Provider>
  )
}
