'use client'

/**
 * Registre mémoire des uploads « en direct » (Lot B).
 *
 * Certaines captures ne passent par AUCUNE file IndexedDB : la vidéo, trop lourde
 * pour IndexedDB + Server Action, part directement vers le stockage via URL signée
 * (cf. VisitBasket.uploadVideoFile). Son état « en cours d'envoi » ne vit donc que
 * dans le composant panier — invisible pour l'indicateur de synchro du header.
 *
 * Ce module comble ce trou : un petit store module-level, réactif, où l'on
 * déclare un upload direct tant qu'il n'est pas confirmé. L'indicateur de synchro
 * (useSyncStatus) et la sheet des éléments en attente s'y abonnent, de sorte que
 * le header cesse d'afficher « Tout est envoyé » pendant qu'une vidéo monte.
 *
 * Volontairement éphémère : contrairement aux files IndexedDB, rien n'est persisté.
 * Un rechargement de page vide le registre — c'est acceptable, l'upload direct est
 * lui-même non repris après fermeture (seul le média en file l'est).
 */

import { useEffect, useState } from 'react'

export interface LiveUpload {
  /** Identité de l'upload — le clientUuid de la capture. */
  id: string
  kind: 'video'
  /** ObjectURL de la vignette (facultatif) — affiché dans la sheet. */
  previewUrl: string | null
  takenAt: number
}

const active = new Map<string, LiveUpload>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Déclare un upload direct en cours (idempotent sur `id`). */
export function beginLiveUpload(entry: LiveUpload): void {
  active.set(entry.id, entry)
  emit()
}

/** Retire un upload direct (confirmé ou abandonné). No-op si absent. */
export function endLiveUpload(id: string): void {
  if (active.delete(id)) emit()
}

/** Instantané courant des uploads directs en cours. */
export function snapshotLiveUploads(): LiveUpload[] {
  return Array.from(active.values())
}

/** Abonnement bas niveau — renvoie une fonction de désabonnement. */
export function subscribeLiveUploads(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Hook React : liste réactive des uploads directs en cours. */
export function useLiveUploads(): LiveUpload[] {
  const [items, setItems] = useState<LiveUpload[]>(() => snapshotLiveUploads())
  useEffect(() => {
    const update = () => setItems(snapshotLiveUploads())
    update()
    return subscribeLiveUploads(update)
  }, [])
  return items
}
