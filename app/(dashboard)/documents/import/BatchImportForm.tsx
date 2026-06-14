'use client'

// Import par lot — triage humain avant import, puis queue séquentielle bornée
// (3 par 3) appelant uploadDocumentAction par fichier. Vincent 2026-05-23.
//
// Doctrine : l'IA propose (couche dérivée du type + reco d'indexation), l'humain
// valide. Couche mémoire NON éditable (résultat du type) ; éditables = type +
// indexation. Pas de tags libres en V1. Litige : indexation verrouillée OFF.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, X, FileUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadDocumentAction } from '../actions'
import { DOCUMENT_TYPE_OPTIONS, VISIBILITY_OPTIONS } from '@/lib/documents/labels'
import { classifyDocument, guessDocumentType, TIER_META } from '@/lib/documents/classify'
import { runPool } from '@/lib/documents/batch'
import { NewCollectionForm } from '../NewCollectionForm'
import { AiCostHint } from '../AiCostHint'

type Collection = { id: string; name: string }
type LinkOption = { id: string; label: string }
type LinkTargets = Record<string, LinkOption[]>

type RowStatus = 'idle' | 'uploading' | 'ok' | 'error' | 'duplicate'
interface Row {
  id: string
  file: File
  documentType: string
  embedOverride: boolean | null // null = suit la reco
  status: RowStatus
  error?: string
}

const TARGET_LABELS: Record<string, string> = {
  contract: 'Contrat', site: 'Site', tender: 'Dossier de démarrage', client: 'Client', team: 'Équipe',
}
const selectCls = 'rounded-md border bg-background px-2 py-1.5 text-sm'

/** Indexation effective d'une ligne (litige = toujours OFF). */
function rowEmbed(row: Row): boolean {
  if (row.documentType === 'litige') return false
  const c = classifyDocument({ documentType: row.documentType, filename: row.file.name })
  return row.embedOverride ?? c.embeddingRecommended
}

export function BatchImportForm({
  collections,
  linkTargets,
  prefillTargetType,
  prefillTargetId,
  avgCostUsd = null,
  costSampleCount = 0,
}: {
  collections: Collection[]
  linkTargets: LinkTargets
  prefillTargetType?: string
  prefillTargetId?: string
  avgCostUsd?: number | null
  costSampleCount?: number
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [collectionId, setCollectionId] = useState('')
  const [visibility, setVisibility] = useState('manager')
  // Pré-rempli si on vient d'une fiche contrat/site (« Ajouter un document »).
  const [targetType, setTargetType] = useState(
    prefillTargetType && linkTargets[prefillTargetType] ? prefillTargetType : '',
  )
  const [targetId, setTargetId] = useState(
    prefillTargetType && linkTargets[prefillTargetType] && prefillTargetId ? prefillTargetId : '',
  )
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)

  function onPick(files: FileList | null) {
    if (!files) return
    const next: Row[] = Array.from(files)
      .filter((f) => f.type === 'application/pdf')
      .map((file) => ({
        id: globalThis.crypto.randomUUID(),
        file,
        documentType: guessDocumentType(file.name),
        embedOverride: null,
        status: 'idle' as RowStatus,
      }))
    setRows(next)
    setDone(false)
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const summary = useMemo(() => {
    const indexed = rows.filter(rowEmbed).length
    return { total: rows.length, indexed, archived: rows.length - indexed }
  }, [rows])

  const canImport =
    collectionId !== '' && rows.length > 0 && !importing &&
    (!targetType || targetId !== '')

  async function importAll() {
    setImporting(true)
    setDone(false)
    // Queue bornée 3-par-3 (jamais Promise.all(N)). Échec d'un fichier =
    // n'interrompt pas les autres (import partiel).
    let failed = 0
    await runPool(rows, 3, async (row) => {
      patchRow(row.id, { status: 'uploading', error: undefined })
      try {
        const fd = new FormData()
        fd.set('file', row.file)
        fd.set('collection_id', collectionId)
        fd.set('document_type', row.documentType)
        fd.set('visibility_level', visibility)
        fd.set('embed', rowEmbed(row) ? 'true' : 'false')
        fd.set('memory_tier', classifyDocument({ documentType: row.documentType, filename: row.file.name }).tier)
        if (targetType && targetId) {
          fd.set('target_type', targetType)
          fd.set('target_id', targetId)
        }
        const r = await uploadDocumentAction(fd)
        if (r.ok) {
          patchRow(row.id, { status: r.duplicate ? 'duplicate' : 'ok' })
        } else {
          failed++
          patchRow(row.id, { status: 'error', error: r.error ?? 'Échec' })
        }
      } catch (e) {
        failed++
        patchRow(row.id, { status: 'error', error: e instanceof Error ? e.message : 'Échec' })
      }
      return null
    })
    setImporting(false)
    setDone(true)
    // Import réussi (aucun échec) → on file à la Bibliothèque.
    if (failed === 0) {
      router.push('/documents')
    } else {
      router.refresh()
    }
  }

  if (collections.length === 0) {
    // Pas de collection → on ne renvoie plus l'utilisateur ailleurs : il en crée
    // une ICI (création rapide sur place), la page se rafraîchit et l'import
    // s'ouvre juste après (Vincent 2026-05-27).
    return (
      <div className="rounded-lg border border-dashed p-5 space-y-3 max-w-lg">
        <p className="text-sm font-medium">Avant d&apos;importer, créez une collection</p>
        <p className="text-xs text-muted-foreground">
          Un document est toujours classé dans une collection (ex. « Contrats »,
          « Sécurité », « Procédures »). Créez-en une ici — l&apos;import s&apos;ouvre juste après.
        </p>
        <NewCollectionForm />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Réglages du lot (une fois) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border bg-card p-4">
        <div>
          <label className="text-xs text-muted-foreground">Collection *</label>
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className={`mt-1 w-full ${selectCls}`}>
            <option value="" disabled>Choisir…</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Visibilité</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={`mt-1 w-full ${selectCls}`}>
            {VISIBILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Rattacher à</label>
            <select
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTargetId('') }}
              className={`mt-1 w-full ${selectCls}`}
            >
              <option value="">— Aucun —</option>
              {Object.keys(linkTargets).map((t) => <option key={t} value={t}>{TARGET_LABELS[t] ?? t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{targetType ? TARGET_LABELS[targetType] : 'Élément'}</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={!targetType}
              className={`mt-1 w-full ${selectCls}`}
            >
              <option value="" disabled>{targetType ? 'Choisir…' : '—'}</option>
              {(linkTargets[targetType] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Dépôt fichiers */}
      <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors">
        <FileUp className="h-4 w-4" />
        Choisir des fichiers PDF…
        <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>

      {/* Tableau de triage */}
      {rows.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b bg-muted/30 text-xs">
            <span className="font-medium">
              {summary.total} fichier{summary.total > 1 ? 's' : ''} · {summary.indexed} à indexer · {summary.archived} archivé{summary.archived > 1 ? 's' : ''}
            </span>
            {!importing && (
              <button type="button" onClick={() => { setRows([]); setDone(false) }} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <Trash2 className="h-3.5 w-3.5" /> Vider
              </button>
            )}
          </div>
          <div className="divide-y">
            {rows.map((row) => {
              const c = classifyDocument({ documentType: row.documentType, filename: row.file.name })
              const isLitige = row.documentType === 'litige'
              const embed = rowEmbed(row)
              return (
                <div key={row.id} className="grid grid-cols-12 items-center gap-2 px-4 py-2.5 text-sm">
                  <div className="col-span-3 min-w-0 truncate" title={row.file.name}>{row.file.name}</div>
                  <div className="col-span-2">
                    <select
                      value={row.documentType}
                      onChange={(e) => patchRow(row.id, { documentType: e.target.value, embedOverride: null })}
                      disabled={importing}
                      className={`w-full ${selectCls} py-1`}
                    >
                      {DOCUMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_META[c.tier].badge}`}>
                      {TIER_META[c.tier].label}
                    </span>
                  </div>
                  <div className="col-span-1">
                    <input
                      type="checkbox"
                      checked={embed}
                      disabled={isLitige || importing}
                      onChange={(e) => patchRow(row.id, { embedOverride: e.target.checked })}
                      className="h-4 w-4"
                      title={isLitige ? 'Litige : jamais indexé (doctrine)' : 'Indexer pour la recherche'}
                    />
                  </div>
                  <div className="col-span-3 text-xs text-muted-foreground truncate" title={c.reason}>{c.reason}</div>
                  <div className="col-span-1 flex justify-end">
                    {row.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {row.status === 'ok' && <Check className="h-4 w-4 text-emerald-600" />}
                    {row.status === 'duplicate' && <span className="text-[10px] font-medium text-amber-600">déjà là</span>}
                    {row.status === 'error' && <X className="h-4 w-4 text-red-600" />}
                  </div>
                </div>
              )
            })}
          </div>
          {/* En-têtes de colonnes (sous le tableau, discrets) */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-t bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Fichier</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-2">Recommandation mémoire</div>
            <div className="col-span-1">Indexer</div>
            <div className="col-span-3">Pourquoi</div>
            <div className="col-span-1" />
          </div>
        </div>
      )}

      {rows.some((r) => r.status === 'error') && done && (
        <p className="text-xs text-red-600">
          {rows.filter((r) => r.status === 'error').length} fichier(s) en échec — les autres ont bien été importés.
          {' '}{rows.find((r) => r.status === 'error')?.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <Button onClick={importAll} disabled={!canImport}>
            {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Import en cours…</> : `Importer ${rows.length || ''} document${rows.length > 1 ? 's' : ''}`}
          </Button>
          <AiCostHint avgUsd={avgCostUsd} sampleCount={costSampleCount} label="analyse de document" />
        </span>
        {!collectionId && rows.length > 0 && (
          <span className="text-xs text-muted-foreground">Choisis une collection.</span>
        )}
        {done && !rows.some((r) => r.status === 'error') && (
          <span className="text-xs text-emerald-700">Import terminé.</span>
        )}
      </div>
    </div>
  )
}
