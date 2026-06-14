'use client'

// Bibliothèque interactive (Vincent 2026-05-27) : groupes de collections
// ordonnés + groupe « Sans collection » (orphelins), édition de collection
// (renommer / réordonner ▲▼ / supprimer 2 modes), et DRAG-DROP natif des
// documents d'une collection à l'autre. Réutilise DocumentRowActions pour les
// actions par document. Mutations → server actions + router.refresh().

import { useState, useTransition, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronUp, ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react'
import { indexationState } from '@/lib/documents/labels'
import { DocumentRowActions } from './DocumentRowActions'
import {
  moveDocumentAction,
  renameCollectionAction,
  reorderCollectionsAction,
  deleteCollectionAction,
} from './actions'

export interface LibDoc {
  id: string
  filename: string
  document_type: string
  memory_tier: 'vivante' | 'consultable' | 'froide' | null
  analysis_status: string
  created_at: string
}
export interface LibGroup {
  /** null = groupe « Sans collection » (orphelins). */
  collectionId: string | null
  name: string
  docs: LibDoc[]
}

const TIER_LABEL: Record<string, string> = { vivante: 'Vivante', consultable: 'Consultable', froide: 'Froide' }
const TARGET_LABEL: Record<string, string> = { contract: 'Contrat', site: 'Site', client: 'Client', tender: 'Dossier', team: 'Équipe' }

function fmtAddedDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function CollectionLibrary({
  groups,
  linkLabels,
  avgCostUsd = null,
  costSampleCount = 0,
}: {
  groups: LibGroup[]
  linkLabels: Record<string, { type: string; label: string }[]>
  avgCostUsd?: number | null
  costSampleCount?: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [dragOver, setDragOver] = useState<string | null>(null) // collectionId|'none'
  const [draggingId, setDraggingId] = useState<string | null>(null) // doc en cours de glissement
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Collections réelles (hors orphelins) dans l'ordre, pour le réordonnancement
  // et le sélecteur de déplacement.
  const realGroups = groups.filter((g) => g.collectionId !== null)
  const allCollections = realGroups.map((g) => ({ id: g.collectionId as string, name: g.name }))

  function refresh() { router.refresh() }

  function moveDoc(docId: string, targetCollectionId: string | null) {
    start(async () => {
      const fd = new FormData()
      fd.set('document_id', docId)
      fd.set('collection_id', targetCollectionId ?? 'none')
      const r = await moveDocumentAction(fd)
      if (r.ok) { toast.success('Document déplacé'); refresh() }
      else toast.error(r.error ?? 'Échec')
    })
  }

  function onDrop(e: DragEvent, targetCollectionId: string | null) {
    e.preventDefault()
    setDragOver(null)
    const docId = e.dataTransfer.getData('text/plain')
    if (!docId) return
    const src = groups.find((g) => g.docs.some((d) => d.id === docId))
    if (src && src.collectionId === targetCollectionId) return // déjà là
    moveDoc(docId, targetCollectionId)
  }

  function rename(collectionId: string, name: string) {
    start(async () => {
      const fd = new FormData()
      fd.set('collection_id', collectionId)
      fd.set('name', name)
      const r = await renameCollectionAction(fd)
      if (r.ok) { setEditing(null); toast.success('Collection renommée'); refresh() }
      else toast.error(r.error ?? 'Échec')
    })
  }

  function reorder(index: number, dir: -1 | 1) {
    const ids = allCollections.map((c) => c.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j]!, ids[index]!]
    start(async () => {
      const r = await reorderCollectionsAction(ids)
      if (r.ok) refresh()
      else toast.error(r.error ?? 'Échec')
    })
  }

  function remove(collectionId: string, mode: 'cascade' | 'orphan') {
    start(async () => {
      const fd = new FormData()
      fd.set('collection_id', collectionId)
      fd.set('mode', mode)
      const r = await deleteCollectionAction(fd)
      if (r.ok) { setConfirmDelete(null); toast.success('Collection supprimée'); refresh() }
      else toast.error(r.error ?? 'Échec')
    })
  }

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => {
        const key = g.collectionId ?? '__none__'
        const isOrphan = g.collectionId === null
        const isDragTarget = dragOver === key
        const realIndex = isOrphan ? -1 : realGroups.findIndex((r) => r.collectionId === g.collectionId)
        return (
          <div
            key={key}
            onDragOver={(e) => { e.preventDefault(); setDragOver(key) }}
            onDragLeave={() => setDragOver((cur) => (cur === key ? null : cur))}
            onDrop={(e) => onDrop(e, g.collectionId)}
            className={`rounded-lg border bg-card p-4 transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out ${isDragTarget ? 'border-brand-400 ring-2 ring-brand-300/50 bg-brand-50/30 shadow-lg motion-safe:-translate-y-0.5 motion-safe:scale-[1.01]' : isOrphan ? 'border-dashed' : ''}`}
          >
            {/* En-tête collection */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {!isOrphan && editing === g.collectionId ? (
                <form
                  className="flex items-center gap-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:duration-150"
                  onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('name') as string)?.trim(); if (v) rename(g.collectionId as string, v) }}
                >
                  <input name="name" defaultValue={g.name} autoFocus minLength={2} maxLength={120}
                    className="text-sm rounded border border-input bg-background px-2 py-1" />
                  <button type="submit" disabled={pending} className="text-emerald-600 p-1 transition-transform active:scale-90" title="Enregistrer"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground p-1 transition-transform active:scale-90" title="Annuler"><X className="h-4 w-4" /></button>
                </form>
              ) : (
                <h3 className="text-sm font-semibold">
                  {g.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">· {g.docs.length} document{g.docs.length > 1 ? 's' : ''}</span>
                </h3>
              )}

              {!isOrphan && editing !== g.collectionId && (
                <div className="ml-auto flex items-center gap-0.5 text-muted-foreground">
                  <button type="button" onClick={() => reorder(realIndex, -1)} disabled={pending || realIndex <= 0} className="p-1 transition-transform hover:text-foreground active:scale-90 disabled:opacity-30 disabled:active:scale-100" title="Monter"><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => reorder(realIndex, 1)} disabled={pending || realIndex >= realGroups.length - 1} className="p-1 transition-transform hover:text-foreground active:scale-90 disabled:opacity-30 disabled:active:scale-100" title="Descendre"><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditing(g.collectionId)} disabled={pending} className="p-1 transition-transform hover:text-foreground active:scale-90" title="Renommer"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setConfirmDelete(g.collectionId)} disabled={pending} className="p-1 transition-transform hover:text-destructive active:scale-90" title="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>

            {/* Confirmation de suppression (2 modes) — jamais pour les orphelins */}
            {!isOrphan && confirmDelete === g.collectionId && (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
                <p>Supprimer « {g.name} » — que faire des {g.docs.length} document{g.docs.length > 1 ? 's' : ''} ?</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => remove(g.collectionId as string, 'orphan')} disabled={pending}
                    className="text-xs rounded-md border px-3 py-1.5 transition-[transform,background-color] hover:bg-muted active:scale-[0.97]">Les mettre sans collection</button>
                  <button type="button" onClick={() => remove(g.collectionId as string, 'cascade')} disabled={pending}
                    className="text-xs rounded-md border border-destructive/40 text-destructive px-3 py-1.5 transition-[transform,background-color] hover:bg-destructive/10 active:scale-[0.97]">Supprimer aussi les fichiers</button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1.5 text-muted-foreground transition-transform active:scale-[0.97]">Annuler</button>
                </div>
              </div>
            )}

            {/* Documents (draggables) */}
            {g.docs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {isOrphan ? 'Aucun document sans collection.' : 'Collection prête — glissez-y un document.'}
              </p>
            ) : (
              <ul className="divide-y">
                {g.docs.map((d) => (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(d.id) }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`flex items-start justify-between gap-3 py-2 text-sm flex-wrap cursor-grab active:cursor-grabbing transition-opacity duration-150 ${draggingId === d.id ? 'opacity-40' : 'opacity-100'}`}
                  >
                    <span className="min-w-0">
                      <Link href={`/documents/${d.id}`} className="font-medium underline hover:text-foreground break-words">{d.filename}</Link>
                      <span className="text-xs text-muted-foreground">
                        {' '}· {d.document_type}
                        {d.memory_tier && <>{' '}· {TIER_LABEL[d.memory_tier] ?? d.memory_tier}</>}
                        {' '}· {indexationState(d.analysis_status, d.memory_tier).label}
                        {' '}· ajouté le {fmtAddedDate(d.created_at)}
                      </span>
                      {(linkLabels[d.id]?.length ?? 0) > 0 && (
                        <span className="block text-[11px] text-muted-foreground/90 mt-0.5">
                          Rattaché à : {linkLabels[d.id]!.map((l) => `${TARGET_LABEL[l.type] ?? l.type} ${l.label}`).join(' · ')}
                        </span>
                      )}
                    </span>
                    <DocumentRowActions
                      documentId={d.id}
                      filename={d.filename}
                      analysisStatus={d.analysis_status}
                      currentCollectionId={g.collectionId ?? undefined}
                      collections={allCollections}
                      avgCostUsd={avgCostUsd}
                      costSampleCount={costSampleCount}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
