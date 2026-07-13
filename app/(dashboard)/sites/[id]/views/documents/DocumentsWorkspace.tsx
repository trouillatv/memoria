import Link from 'next/link'
import { Download, FileSearch, FolderCheck, Search, ShieldCheck, Upload } from 'lucide-react'
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
  proofDossiers,
  qr,
}: {
  siteId: string
  canExport: boolean
  documents: SiteDocumentSummary[]
  proofDossiers: ProofDossier[]
  qr: DocumentsQrState
}) {
  const pendingProofs = proofDossiers.filter((dossier) => !dossier.moeValidated).length

  return (
    <main className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documents & preuves</h1>
        <p className="text-sm text-muted-foreground">Ici je peux retrouver ou recevoir une preuve.</p>
      </header>

      <section className="rounded-[22px] border border-sky-100 bg-card p-5 shadow-sm dark:border-sky-950/50" aria-labelledby="site-library-title">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 id="site-library-title" className="text-lg font-semibold">Bibliothèque</h2>
            <p className="text-sm text-muted-foreground">
              {documents.length} document{documents.length > 1 ? 's' : ''} dans le chantier · {proofDossiers.length} dossier{proofDossiers.length > 1 ? 's' : ''} de preuves alimenté{proofDossiers.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && (
              <Link href={`/sites/${siteId}/export`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                <Download className="h-4 w-4" />
                Exporter
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
          <input className="h-11 w-full rounded-xl border bg-background pl-9 pr-3 text-sm" placeholder="Rechercher une photo, un plan, un PV..." />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {['Tous', 'Photos', 'Vidéos', 'Vocaux', 'Plans', 'PV', 'CR', 'Justificatifs'].map((item, index) => (
            <button
              key={item}
              type="button"
              className={index === 0
                ? 'rounded-full border bg-sky-700 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'}
            >
              {item}
            </button>
          ))}
        </div>
        {documents.length > 0 ? (
          <div className="mt-6 divide-y rounded-2xl border">
            {documents.slice(0, 6).map((document) => (
              <div key={document.id} className="flex flex-col gap-1 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{document.filename}</p>
                  <p className="text-sm text-muted-foreground">{document.document_type}</p>
                </div>
                {document.created_at && <p className="text-sm text-muted-foreground">{formatDate(document.created_at)}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
            <FileSearch className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Aucun document pour le moment.</p>
            <p className="text-sm text-muted-foreground">Ajoutez un document, une photo, un plan ou un PV.</p>
            <p className="mt-1 text-sm text-muted-foreground">La bibliothèque se remplira au fur et à mesure des visites.</p>
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
    <div className="mt-4 grid gap-5 rounded-2xl border p-4 lg:grid-cols-[260px_1fr]">
      <div className="rounded-xl bg-white p-4 text-center">
        {qr.qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr.qrDataUrl}
            alt={`QR de collecte externe - ${qr.siteName}`}
            width={220}
            height={220}
            className="mx-auto rounded"
          />
        )}
        {qr.qrDataUrl && (
          <a
            href={qr.qrDataUrl}
            download={`qr-${slugify(qr.siteName)}.png`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Télécharger
          </a>
        )}
      </div>
      <div className="flex flex-col justify-between gap-4">
        <div>
          <p className="font-medium">QR de collecte externe</p>
          <p className="mt-1 text-sm text-muted-foreground">Lien public en lecture ou contribution selon les droits réels du lien.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span className="rounded-full border px-2 py-1">{qr.accessCount} accès anonyme{qr.accessCount > 1 ? 's' : ''}</span>
            {qr.lastAccessedAt && <span className="rounded-full border px-2 py-1">Dernier accès {formatDate(qr.lastAccessedAt)}</span>}
            {qr.generatedAt && <span className="rounded-full border px-2 py-1">Généré le {formatDate(qr.generatedAt)}</span>}
          </div>
        </div>
        {qr.publicUrl && <QrShareActions siteName={qr.siteName} publicUrl={qr.publicUrl} />}
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">Historique et sécurité</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            {anonymousScans} accès anonyme{anonymousScans > 1 ? 's' : ''}. Aucune personne n'est affichée sans identification réelle.
          </p>
          <QrHistory history={qr.history} />
          <div className="mt-4 border-t pt-4">
            <RevokeQrButton siteId={siteId} />
          </div>
        </details>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
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
