import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'qrcode'
import { QrCode, Download, Eye, Clock, ShieldOff } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteQrInfo } from '@/lib/db/site-qr'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { ActivateQrButton } from './ActivateQrButton'
import { RevokeQrButton } from './RevokeQrButton'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteQrPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const info = await getSiteQrInfo(id)
  if (!info) notFound()

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const tok = info.token
  let qrDataUrl: string | null = null
  const publicUrl = tok ? `${baseUrl}/qr/${tok.token}` : null

  if (publicUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(publicUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
    } catch {
      // non bloquant
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          timeZone: 'Pacific/Noumea',
        })
      : null

  return (
    <div className="space-y-6 w-full max-w-lg">
      <DynamicCrumb segmentId="qr" label="QR Code" />
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Sites' },
        { href: `/sites/${id}`, label: info.name },
      ]} />

      <Link
        href={`/sites/${id}`}
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← {info.name}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <QrCode className="h-5 w-5 text-muted-foreground" />
          QR Code chantier
        </h1>
        <p className="text-sm text-muted-foreground">
          Scannez ce code pour accéder au journal du chantier sans connexion.
        </p>
      </header>

      {!tok ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
          <QrCode className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Pas encore de QR Code</p>
            <p className="text-xs text-muted-foreground">
              Générez un lien unique pour ce chantier. Il sera valable indéfiniment, sauf révocation.
            </p>
          </div>
          <ActivateQrButton siteId={id} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* QR Code image */}
          {qrDataUrl && (
            <div className="rounded-lg border bg-white p-6 flex flex-col items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR Code — ${info.name}`}
                width={240}
                height={240}
                className="rounded"
              />
              <div className="flex items-center gap-3">
                <a
                  href={qrDataUrl}
                  download={`qr-${info.name.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}.png`}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Télécharger
                </a>
                <a
                  href={publicUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Aperçu
                </a>
              </div>
            </div>
          )}

          {/* URL publique */}
          <div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Lien public
            </p>
            <p className="text-sm font-mono break-all text-foreground/80">{publicUrl}</p>
          </div>

          {/* Stats d'accès */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {tok.access_count} accès
            </span>
            {tok.last_accessed_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Dernier : {fmt(tok.last_accessed_at)}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Ce QR Code donne accès en lecture seule au journal du chantier, sans connexion.
            Idéal pour une impression à coller sur la porte ou dans le bureau de chantier.
          </p>

          {/* Révocation */}
          <div className="border-t pt-4 flex items-center gap-3">
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">
                Révoquer génère un lien invalide immédiatement. Un nouveau QR Code peut être créé après.
              </p>
            </div>
            <RevokeQrButton siteId={id} />
          </div>
        </div>
      )}
    </div>
  )
}
