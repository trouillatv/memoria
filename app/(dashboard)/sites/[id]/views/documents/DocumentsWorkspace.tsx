'use client'

import { documentHref } from '@/lib/knowledge/document-href'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Download, FileSearch, FileText, FolderCheck, ImageIcon, Mic, Search, ShieldCheck, StickyNote, Upload, Video } from 'lucide-react'
import type { ProofDossier } from '@/lib/db/proof-dossier'
import type { QrHistoryEvent } from '@/lib/db/site-qr'
import { ActivateQrButton } from '../../qr/ActivateQrButton'
import { QrShareActions } from '../../qr/QrShareActions'
import { RevokeQrButton } from '../../qr/RevokeQrButton'

export interface SiteDocumentSummary {
  id: string
  filename: string
  document_type: string
  created_at?: string | null
}

export interface SiteMediaSummary {
  id: string
  kind: 'photo' | 'video' | 'vocal' | 'note'
  title: string
  detail: string
  occurredAt: string | null
  source: 'intervention' | 'action' | 'report' | 'visit'
  href: string
  thumbUrl?: string | null
  previewUrl?: string | null
}

export interface DocumentsQrState {
  siteName: string
  status: 'none' | 'active' | 'revoked'
  publicUrl: string | null
  qrDataUrl: string | null
  accessCount: number
  generatedAt: string | null
  lastAccessedAt: string | null
  history: QrHistoryEvent[]
}

export function DocumentsWorkspace({
  siteId,
  canExport,
  documents,
  media = [],
  proofDossiers,
  qr,
}: {
  siteId: string
  canExport: boolean
  documents: SiteDocumentSummary[]
  media?: SiteMediaSummary[]
  proofDossiers: ProofDossier[]
  qr: DocumentsQrState
}) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('Tous')
  const pendingProofs = proofDossiers.filter((dossier) => !dossier.moeValidated).length
  const filters = ['Tous', 'Photos', 'Vidéos', 'Vocaux', 'Notes', 'Plans', 'PV', 'CR', 'Justificatifs']
  const libraryEntries = useMemo(() => {
    const docEntries: LibraryEntry[] = documents.map((document) => ({
      id: `document-${document.id}`,
      kind: 'document',
      title: document.filename,
      detail: document.document_type || 'Document',
      occurredAt: document.created_at ?? null,
      // La bibliothèque du chantier OUVRE l'objet du graphe (fiche document dans
      // son contexte de chantier) ; la visionneuse /documents/<id> reste la
      // sortie nommée depuis cette fiche (fichier, URL signée, journal d'accès).
      href: documentHref(document, siteId),
      searchable: `${document.filename} ${document.document_type}`,
    }))
    const mediaEntries: LibraryEntry[] = media.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: `${kindLabel(item.kind)} · ${sourceLabel(item.source)}${item.detail ? ` · ${item.detail}` : ''}`,
      occurredAt: item.occurredAt,
      href: item.href,
      thumbUrl: item.thumbUrl ?? null,
      previewUrl: item.previewUrl ?? null,
      searchable: `${item.title} ${item.detail} ${kindLabel(item.kind)} ${sourceLabel(item.source)}`,
    }))
    return [...docEntries, ...mediaEntries].sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))
  }, [documents, media, siteId])
  const filteredEntries = useMemo(() => {
    const normalizedQuery = normalize(query)
    return libraryEntries.filter((entry) => {
      const matchesQuery = normalizedQuery.length === 0
        || normalize(entry.title).includes(normalizedQuery)
        || normalize(entry.detail).includes(normalizedQuery)
        || normalize(entry.searchable).includes(normalizedQuery)
      const matchesType = activeType === 'Tous' || entryMatchesType(entry, activeType)
      return matchesQuery && matchesType
    })
  }, [activeType, libraryEntries, query])

  return (
    <main className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documents & preuves</h1>
        <p className="text-sm text-muted-foreground">Ici, je peux retrouver ou recevoir une preuve.</p>
      </header>

      <section className="rounded-[22px] border border-sky-100 bg-card p-5 shadow-sm dark:border-sky-950/50" aria-labelledby="site-library-title">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 id="site-library-title" className="text-lg font-semibold">Bibliothèque</h2>
            <p className="text-sm text-muted-foreground">
              {libraryEntries.length} trace{libraryEntries.length > 1 ? 's' : ''} dans le chantier · {proofDossiers.length} dossier{proofDossiers.length > 1 ? 's' : ''} de preuves alimenté{proofDossiers.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && (
              <Link href={`/sites/${siteId}/export`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                <Download className="h-4 w-4" />
                Exporter la bibliothèque
              </Link>
            )}
            <Link href={`/documents/import?target_type=site&target_id=${siteId}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">
              <Upload className="h-4 w-4" />
              Ajouter
            </Link>
          </div>
        </div>
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-11 w-full rounded-xl border bg-background pl-9 pr-3 text-sm"
            placeholder="Rechercher une photo, un plan, un PV..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={activeType === item}
              onClick={() => setActiveType(item)}
              className={activeType === item
                ? 'rounded-full border bg-sky-700 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'}
            >
              {item}
            </button>
          ))}
        </div>
        {filteredEntries.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[minmax(0,1fr)_130px_130px] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Nom</span>
              <span>Type</span>
              <span>Date</span>
            </div>
            <div className="divide-y">
              {filteredEntries.slice(0, 40).map((entry) => (
                // scroll={false} pour un document : la fiche s'ouvre en panneau,
                // la liste ne doit pas remonter en haut de page.
                <Link key={entry.id} href={entry.href} scroll={entry.kind !== 'document'} className="grid min-h-14 grid-cols-[minmax(0,1fr)_130px_130px] gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-3">
                    <LibraryIcon entry={entry} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{entry.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>
                    </span>
                  </span>
                  <span className="flex items-center text-sm text-muted-foreground">{kindLabel(entry.kind)}</span>
                  <span className="flex items-center text-sm text-muted-foreground">{entry.occurredAt ? formatDate(entry.occurredAt) : 'Non daté'}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : libraryEntries.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
            <FileSearch className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Aucun document pour le moment.</p>
            <p className="text-sm text-muted-foreground">Ajoutez un document, une photo, un plan ou un PV.</p>
            <p className="mt-1 text-sm text-muted-foreground">La bibliothèque se remplira au fur et à mesure des visites.</p>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
            <FileSearch className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Aucun document ne correspond à cette recherche.</p>
            <p className="text-sm text-muted-foreground">Modifiez le texte ou le filtre sélectionné.</p>
          </div>
        )}
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="receive-proofs-title">
        <h2 id="receive-proofs-title" className="text-lg font-semibold">Recevoir des preuves</h2>
        <p className="mt-1 text-sm text-muted-foreground">Le QR est un canal de collecte qui alimente les traces du chantier.</p>
        <SiteQrCollectionPanel siteId={siteId} qr={qr} />
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="proof-folders-title">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <h2 id="proof-folders-title" className="text-lg font-semibold">Dossiers de preuves</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span>{proofDossiers.length} dossier{proofDossiers.length > 1 ? 's' : ''} actif{proofDossiers.length > 1 ? 's' : ''}</span>
                <span>{pendingProofs} preuve{pendingProofs > 1 ? 's' : ''} à vérifier</span>
              </div>
            </div>
          </div>
          <Link href={`/sites/${siteId}/preuves`} className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
            Ouvrir
          </Link>
        </div>
        {proofDossiers.length > 0 && (
          <div className="mt-4 divide-y rounded-2xl border">
            {proofDossiers.slice(0, 3).map((dossier) => (
              <Link key={dossier.actionId} href={`/sites/${siteId}/preuves`} className="flex flex-col gap-1 p-4 hover:bg-muted/40 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{dossier.actionTitle}</p>
                  <p className="text-sm text-muted-foreground">{dossier.recipientLabel}</p>
                </div>
                <span className={dossier.moeValidated
                  ? 'rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100'
                  : 'rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-100'}
                >
                  {dossier.moeValidated ? 'Validée' : 'À vérifier'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function SiteQrCollectionPanel({ siteId, qr }: { siteId: string; qr: DocumentsQrState }) {
  const anonymousScans = qr.history.filter((event) => event.type === 'scanned').length

  if (qr.status === 'none') {
    return (
      <div className="mt-4 rounded-2xl border border-dashed p-6 text-center">
        <FolderCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Aucun QR généré.</p>
        <p className="mb-4 text-sm text-muted-foreground">Créez un lien de collecte externe pour recevoir des traces depuis le chantier.</p>
        <ActivateQrButton siteId={siteId} />
      </div>
    )
  }

  if (qr.status === 'revoked') {
    return (
      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/40 p-6 dark:border-rose-950 dark:bg-rose-950/10">
        <p className="font-medium text-rose-700 dark:text-rose-300">QR révoqué</p>
        <p className="mt-1 text-sm text-muted-foreground">Ce lien n'est plus utilisable.</p>
        <div className="mt-4">
          <ActivateQrButton siteId={siteId} />
        </div>
        <QrHistory history={qr.history} />
      </div>
    )
  }

  return (
    // Le QR n'a plus besoin de toute la largeur : la moitié droite sert à montrer
    // ce que le canal a réellement rapporté.
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-[150px_1fr]">
        <div className="rounded-xl bg-white p-2 text-center">
          {qr.qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr.qrDataUrl}
              alt={`QR de collecte externe - ${qr.siteName}`}
              width={134}
              height={134}
              className="mx-auto rounded"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <p className="font-medium">QR de collecte externe</p>
            <p className="mt-1 text-sm text-muted-foreground">Accès en lecture seule.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {qr.accessCount} accès anonyme{qr.accessCount > 1 ? 's' : ''}
              {qr.generatedAt && ` · généré le ${formatDate(qr.generatedAt)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {qr.publicUrl && <QrShareActions siteName={qr.siteName} publicUrl={qr.publicUrl} />}
            {qr.qrDataUrl && (
              <a
                href={qr.qrDataUrl}
                download={`qr-${slugify(qr.siteName)}.png`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </a>
            )}
          </div>
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">Historique et sécurité</summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {anonymousScans} accès anonyme{anonymousScans > 1 ? 's' : ''} · aucun contributeur identifié.
            </p>
            <QrHistory history={qr.history} />
            <div className="mt-4 border-t pt-4">
              <RevokeQrButton siteId={siteId} />
            </div>
          </details>
        </div>
      </div>

      <div className="rounded-2xl border p-4">
        <p className="font-medium">Dernières contributions externes</p>
        {qr.lastAccessedAt ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Dernier accès le {formatDate(qr.lastAccessedAt)}. Les contributions reçues rejoignent la bibliothèque ci-dessus.
            </p>
            <QrHistory history={qr.history.filter((event) => event.type === 'scanned')} />
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Aucune contribution reçue. Partagez le QR pour qu’une preuve puisse arriver du chantier.
          </p>
        )}
      </div>
    </div>
  )
}

function QrHistory({ history }: { history: QrHistoryEvent[] }) {
  if (history.length === 0) return null
  return (
    <ol className="mt-3 space-y-2 text-sm">
      {history.slice(0, 6).map((event, index) => (
        <li key={`${event.type}-${event.at}-${index}`} className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="font-medium text-foreground">
            {event.type === 'generated' && 'Généré'}
            {event.type === 'revoked' && 'Révoqué'}
            {event.type === 'scanned' && 'Accès anonyme'}
          </span>
          <span>{formatDateTime(event.at)}</span>
          <span className="font-mono text-xs">…{event.tokenSuffix}</span>
        </li>
      ))}
    </ol>
  )
}

type LibraryEntry = {
  id: string
  kind: 'document' | SiteMediaSummary['kind']
  title: string
  detail: string
  occurredAt: string | null
  href: string
  searchable: string
  thumbUrl?: string | null
  previewUrl?: string | null
}

function LibraryIcon({ entry }: { entry: LibraryEntry }) {
  if (entry.kind === 'photo' && entry.thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={entry.thumbUrl} alt="" className="h-9 w-9 shrink-0 rounded-md border object-cover" />
    )
  }
  const Icon = entry.kind === 'photo'
    ? ImageIcon
    : entry.kind === 'video'
      ? Video
      : entry.kind === 'vocal'
        ? Mic
        : entry.kind === 'note'
          ? StickyNote
          : FileText
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
      <Icon className="h-4 w-4" />
    </span>
  )
}

function kindLabel(kind: LibraryEntry['kind']): string {
  if (kind === 'photo') return 'Photo'
  if (kind === 'video') return 'Vidéo'
  if (kind === 'vocal') return 'Vocal'
  if (kind === 'note') return 'Note'
  return 'Document'
}

function sourceLabel(source: SiteMediaSummary['source']): string {
  if (source === 'intervention') return 'intervention'
  if (source === 'action') return 'action'
  if (source === 'visit') return 'visite'
  return 'réunion'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function entryMatchesType(entry: LibraryEntry, filter: string): boolean {
  const value = normalize(`${entry.detail} ${entry.title} ${entry.searchable}`)
  if (filter === 'Photos') return entry.kind === 'photo' || ['photo', 'image', 'jpg', 'jpeg', 'png', 'webp'].some((token) => value.includes(token))
  if (filter === 'Vidéos') return entry.kind === 'video' || ['video', 'mp4', 'mov'].some((token) => value.includes(token))
  if (filter === 'Vocaux') return entry.kind === 'vocal' || ['audio', 'vocal', 'mp3', 'm4a', 'wav'].some((token) => value.includes(token))
  if (filter === 'Notes') return entry.kind === 'note'
  const checks: Record<string, string[]> = {
    Photos: ['photo', 'image', 'jpg', 'jpeg', 'png', 'webp'],
    Vidéos: ['video', 'mp4', 'mov'],
    Vocaux: ['audio', 'vocal', 'mp3', 'm4a', 'wav'],
    Plans: ['plan'],
    PV: ['pv', 'proces-verbal', 'proces verbal'],
    CR: ['cr', 'compte-rendu', 'compte rendu'],
    Justificatifs: ['justificatif', 'attestation', 'facture'],
  }
  return (checks[filter] ?? []).some((token) => value.includes(token))
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30) || 'chantier'
}
