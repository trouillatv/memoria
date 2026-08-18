'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { VoiceOrbContext, type OpenOrbOptions, type PendingProposal } from './VoiceOrbContext'
import { VoiceOrbOverlay } from '@/components/field/VoiceOrbOverlay'
import { VoiceLatencyBadge } from '@/components/field/VoiceLatencyBadge'

type OrbSession = OpenOrbOptions & { open: boolean }

const CLOSED: OrbSession = { open: false, siteId: '', onVoiceTurn: async () => {} }

export function VoiceOrbProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<OrbSession>(CLOSED)
  const [pendingProposals, setPendingProposals] = useState<PendingProposal[]>([])
  const viewHandlerRef = useRef<((id: string) => void) | null>(null)
  // Armé par `viewPendingProposal` : la feuille devient un drill-down temporaire
  // de CETTE proposition, pas une nouvelle destination. Une proposition validée
  // ou consultée directement depuis la feuille (jamais via le bandeau) ne l'arme
  // jamais — c'est cette distinction qui décide du retour automatique à l'orbe
  // (Vincent, 2026-08-18).
  const viewedFromOrbRef = useRef(false)

  const openOrb = useCallback((opts: OpenOrbOptions) => {
    viewedFromOrbRef.current = false
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
    viewedFromOrbRef.current = true
    closeOrb()
    viewHandlerRef.current?.(id)
  }, [closeOrb])

  const registerProposalViewHandler = useCallback((handler: ((id: string) => void) | null) => {
    viewHandlerRef.current = handler
  }, [])

  // Retour automatique à l'orbe : la proposition consultée depuis le bandeau
  // vient d'être résolue (validée ou annulée) et il n'en reste aucune autre en
  // attente. Ne se déclenche jamais pour une proposition résolue directement
  // dans la feuille — `viewedFromOrbRef` n'est armé que par `viewPendingProposal`.
  // Une file encore non vide (futur P6-B) laisse volontairement l'utilisateur
  // dans la feuille : l'avancée carte par carte reste à construire.
  useEffect(() => {
    if (viewedFromOrbRef.current && pendingProposals.length === 0) {
      viewedFromOrbRef.current = false
      setSession((prev) => (prev.open ? prev : { ...prev, open: true }))
    }
  }, [pendingProposals])

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
